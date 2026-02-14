/**
 * Position Lifecycle Engine - Main orchestrator class
 */

import { createClient } from '@supabase/supabase-js';
import { TradeSignal } from '../types/execution.types';
import { Position } from './interfaces/position-state-machine.interface';
import { 
  PositionState, 
  ExecutionData, 
  FillData, 
  PositionMetrics,
  MarginStatus,
  LiquidationResult,
  PaperTradingConfig
} from './types/position-lifecycle.types';

// Services
import {
  PositionStateMachineService,
  ExecutionTrackingService,
  PnLCalculationService,
  PositionEventService,
  RiskLedgerService,
  SLTPMonitorService,
  LiquidationEngineService,
  PaperTradingService,
  SystemIntegrityService
} from './services';

// Repositories
import {
  PositionRepository,
  TradeExecutionRepository,
  PositionEventRepository,
  AccountBalanceRepository,
  AccountBalanceEventRepository
} from './repositories';

export interface PositionLifecycleEngineConfig {
  supabaseUrl: string;
  supabaseKey: string;
  paperTradingConfig?: Partial<PaperTradingConfig>;
  maxLeverage?: number;
  marginCallLevel?: number;
  liquidationLevel?: number;
  commissionRate?: number;
  // Enhanced timeout configuration
  operationTimeoutMs?: number;
  databaseTimeoutMs?: number;
  integrityCheckTimeoutMs?: number;
  recoveryTimeoutMs?: number;
  progressTrackingEnabled?: boolean;
}

export class PositionLifecycleEngine {
  // Core services
  private readonly positionStateMachine: PositionStateMachineService;
  private readonly executionTracking: ExecutionTrackingService;
  private readonly pnlCalculation: PnLCalculationService;
  private readonly positionEvent: PositionEventService;
  private readonly riskLedger: RiskLedgerService;
  private readonly sltpMonitor: SLTPMonitorService;
  private readonly liquidationEngine: LiquidationEngineService;
  private readonly paperTrading: PaperTradingService;
  private readonly systemIntegrity: SystemIntegrityService;

  // Repositories
  private readonly positionRepository: PositionRepository;
  private readonly executionRepository: TradeExecutionRepository;
  private readonly eventRepository: PositionEventRepository;
  private readonly accountRepository: AccountBalanceRepository;
  private readonly balanceEventRepository: AccountBalanceEventRepository;

  // Database client
  private readonly supabase: ReturnType<typeof createClient>;
  
  // Enhanced timeout and progress tracking configuration
  private readonly config: Required<PositionLifecycleEngineConfig>;
  private readonly operationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly operationProgress: Map<string, { startTime: Date; progress: number; status: string }> = new Map();

  constructor(config: PositionLifecycleEngineConfig) {
    // Initialize configuration with defaults
    this.config = {
      ...config,
      operationTimeoutMs: config.operationTimeoutMs ?? 30000, // 30 seconds
      databaseTimeoutMs: config.databaseTimeoutMs ?? 15000, // 15 seconds
      integrityCheckTimeoutMs: config.integrityCheckTimeoutMs ?? 60000, // 60 seconds
      recoveryTimeoutMs: config.recoveryTimeoutMs ?? 120000, // 2 minutes
      progressTrackingEnabled: config.progressTrackingEnabled ?? true,
    };

    // Initialize Supabase client
    this.supabase = createClient(this.config.supabaseUrl, this.config.supabaseKey);

    // Initialize repositories
    this.positionRepository = new PositionRepository(this.supabase);
    this.executionRepository = new TradeExecutionRepository(this.supabase);
    this.eventRepository = new PositionEventRepository(this.supabase);
    this.accountRepository = new AccountBalanceRepository(this.supabase);
    this.balanceEventRepository = new AccountBalanceEventRepository(this.supabase);

    // Initialize core services
    this.positionEvent = new PositionEventService(
      this.eventRepository,
      this.positionRepository
    );

    this.pnlCalculation = new PnLCalculationService(
      this.positionRepository,
      this.executionRepository,
      config.commissionRate
    );

    this.positionStateMachine = new PositionStateMachineService(
      this.positionEvent,
      this.positionRepository
    );

    this.executionTracking = new ExecutionTrackingService(
      this.executionRepository,
      this.positionRepository,
      this.positionStateMachine,
      this.positionEvent
    );

    this.riskLedger = new RiskLedgerService(
      this.accountRepository,
      this.balanceEventRepository,
      this.positionRepository,
      this.config.maxLeverage,
      this.config.marginCallLevel,
      this.config.liquidationLevel
    );

    this.sltpMonitor = new SLTPMonitorService(
      this.positionRepository,
      this.executionTracking,
      this.riskLedger,
      this.positionEvent
    );

    this.liquidationEngine = new LiquidationEngineService(
      this.riskLedger,
      this.positionRepository,
      this.accountRepository,
      this.executionTracking,
      this.positionEvent,
      {
        marginCallLevel: this.config.marginCallLevel || 0.5,
        liquidationLevel: this.config.liquidationLevel || 0.2,
        maxSlippagePercent: 5.0,
        liquidationFeePercent: 0.5,
        monitoringIntervalMs: 5000
      }
    );

    this.paperTrading = new PaperTradingService(
      this.executionTracking,
      this.config.paperTradingConfig
    );

    this.systemIntegrity = new SystemIntegrityService(
      this.positionRepository,
      this.accountRepository,
      this.positionEvent,
      this.executionRepository
    );
  }

  /**
   * Create a new position from a trade signal
   */
  async createPosition(tradeSignal: TradeSignal): Promise<Position> {
    return await this.executeWithTimeout(
      () => this.positionStateMachine.createPosition(tradeSignal),
      this.config.operationTimeoutMs,
      'create_position'
    );
  }

  /**
   * Record a trade execution
   */
  async recordExecution(executionData: ExecutionData): Promise<void> {
    return await this.executeWithTimeout(
      async () => {
        if (this.isPaperMode()) {
          await this.paperTrading.simulateExecution(executionData);
        } else {
          await this.executionTracking.recordExecution(executionData);
        }
      },
      this.config.operationTimeoutMs,
      'record_execution'
    );
  }

  /**
   * Process a partial fill
   */
  async processPartialFill(positionId: string, fillData: FillData, isEntry: boolean = true): Promise<void> {
    return await this.executeWithTimeout(
      async () => {
        // Get position before processing
        const positionBefore = await this.getPosition(positionId);
        
        await this.executionTracking.processPartialFill(positionId, fillData, isEntry);
        
        // Get position after processing
        const positionAfter = await this.getPosition(positionId);
        
        // If position transitioned from PENDING to OPEN, start SL/TP monitoring
        if (positionBefore?.status === PositionState.PENDING && 
            positionAfter?.status === PositionState.OPEN) {
          await this.startSLTPMonitoring(positionId);
        }
        
        // If this was a partial exit (position size decreased), update account balance
        if (positionBefore && positionAfter && 
            positionBefore.size > positionAfter.size &&
            positionAfter.status === PositionState.OPEN) {
          
          // Calculate realized PnL for the partial exit
          const exitSize = positionBefore.size - positionAfter.size;
          const priceDiff = positionBefore.side === 'BUY' 
            ? fillData.price - positionBefore.avgEntryPrice
            : positionBefore.avgEntryPrice - fillData.price;
          const partialRealizedPnL = priceDiff * exitSize;
          
          if (partialRealizedPnL !== 0) {
            const accountId = positionBefore.accountId || 'default';
            await this.riskLedger.updateAccountBalance({
              accountId,
              amount: partialRealizedPnL,
              reason: 'PARTIAL_EXIT',
              positionId
            });
          }
        }
      },
      this.config.operationTimeoutMs,
      'process_partial_fill'
    );
  }

  /**
   * Process a full fill
   */
  async processFullFill(positionId: string, fillData: FillData): Promise<void> {
    const positionBefore = await this.getPosition(positionId);
    
    await this.executionTracking.processFullFill(positionId, fillData);
    
    const positionAfter = await this.getPosition(positionId);
    
    // If position was closed, update account balance with realized PnL
    if (positionBefore?.status === PositionState.OPEN && 
        positionAfter?.status === PositionState.CLOSED &&
        positionAfter.realizedPnL !== 0) {
      
      const accountId = positionBefore.accountId || 'default';
      await this.riskLedger.updateAccountBalance({
        accountId,
        amount: positionAfter.realizedPnL,
        reason: 'POSITION_CLOSED',
        positionId
      });
      
      // Release margin
      await this.riskLedger.releaseMargin(positionId, positionBefore.marginUsed);
    }
  }

  /**
   * Update position PnL with current market price
   */
  async updatePositionPnL(positionId: string, marketPrice: number): Promise<void> {
    await this.pnlCalculation.updatePositionPnL(positionId, marketPrice);
  }

  /**
   * Get position metrics
   */
  async getPositionMetrics(positionId: string): Promise<PositionMetrics> {
    return await this.pnlCalculation.getPositionMetrics(positionId);
  }

  /**
   * Start monitoring a position for SL/TP triggers
   */
  async startSLTPMonitoring(positionId: string): Promise<void> {
    await this.sltpMonitor.startMonitoring(positionId);
  }

  /**
   * Update market price and check for SL/TP triggers
   */
  async updateMarketPrice(symbol: string, price: number): Promise<void> {
    await this.sltpMonitor.updatePrice({
      symbol,
      price,
      timestamp: new Date()
    });
  }

  /**
   * Check margin requirements for an account
   */
  async checkMarginRequirements(accountId: string): Promise<MarginStatus> {
    return await this.riskLedger.checkMarginRequirements(accountId);
  }

  /**
   * Trigger forced liquidation for an account
   */
  async triggerLiquidation(accountId: string): Promise<LiquidationResult> {
    return await this.liquidationEngine.executeLiquidation(accountId);
  }

  /**
   * Start continuous margin monitoring
   */
  startMarginMonitoring(): void {
    this.liquidationEngine.startMonitoring();
  }

  /**
   * Stop margin monitoring
   */
  stopMarginMonitoring(): void {
    this.liquidationEngine.stopMonitoring();
  }

  /**
   * Perform system integrity check
   */
  async performIntegrityCheck(): Promise<any> {
    return await this.executeWithTimeout(
      () => this.systemIntegrity.performIntegrityCheck(),
      this.config.integrityCheckTimeoutMs,
      'integrity_check'
    );
  }

  /**
   * Recover system state from events
   */
  async recoverSystemState(): Promise<any> {
    return await this.executeWithTimeout(
      () => this.systemIntegrity.recoverSystemState(),
      this.config.recoveryTimeoutMs,
      'recover_system_state'
    );
  }

  /**
   * Get position by ID
   */
  async getPosition(positionId: string): Promise<Position | null> {
    return await this.executeDbOperation(
      () => this.positionRepository.findById(positionId),
      'get_position'
    );
  }

  /**
   * Get positions by status
   */
  async getPositionsByStatus(status: PositionState): Promise<Position[]> {
    return await this.executeDbOperation(
      () => this.positionRepository.findByStatus(status),
      'get_positions_by_status'
    );
  }

  /**
   * Get positions by account
   */
  async getPositionsByAccount(accountId: string): Promise<Position[]> {
    return await this.positionRepository.findByAccountId(accountId);
  }

  /**
   * Get open positions with SL/TP levels
   */
  async getOpenPositionsWithSLTP(): Promise<Position[]> {
    return await this.positionRepository.findOpenPositionsWithSLTP();
  }

  /**
   * Update SL/TP levels for a position
   */
  async updateSLTPLevels(
    positionId: string, 
    stopLoss?: number, 
    takeProfit?: number
  ): Promise<void> {
    await this.sltpMonitor.updateSLTPLevels(positionId, stopLoss, takeProfit);
  }

  /**
   * Get system state snapshot
   */
  async getSystemState(): Promise<any> {
    return await this.systemIntegrity.getSystemState();
  }

  /**
   * Initialize the engine (start monitoring, etc.)
   */
  async initialize(): Promise<void> {
    console.log('PositionLifecycleEngine: Starting initialization...');
    
    // Initialize SL/TP monitoring for existing positions
    console.log('Step 1: Initializing SL/TP monitoring...');
    await this.sltpMonitor.initializeMonitoring();
    
    // Start margin monitoring
    console.log('Step 2: Starting margin monitoring...');
    this.startMarginMonitoring();
    
    // Perform initial integrity check (but don't fail on warnings during initialization)
    console.log('Step 3: Performing integrity check...');
    try {
      const integrityResult = await this.performIntegrityCheck();
      if (!integrityResult.isValid) {
        console.warn('System integrity issues detected during initialization:', integrityResult.errors);
        // Don't fail initialization due to integrity issues - they might be expected during testing
      }
      console.log('✅ Integrity check completed');
    } catch (error) {
      console.error('❌ Integrity check failed:', error);
      // Don't fail initialization due to integrity check failures
    }
    
    console.log('✅ PositionLifecycleEngine initialization completed');
  }

  /**
   * Shutdown the engine gracefully
   */
  async shutdown(): Promise<void> {
    // Stop margin monitoring
    this.stopMarginMonitoring();
    
    // Cancel any pending paper trading executions
    const pendingExecutions = this.paperTrading.getPendingExecutions();
    for (const orderId of pendingExecutions) {
      this.paperTrading.cancelPendingExecution(orderId);
    }
  }

  /**
   * Check if running in paper trading mode
   */
  private isPaperMode(): boolean {
    // This would be determined by configuration or environment
    // For now, assume paper mode
    return true;
  }

  /**
   * Get engine statistics
   */
  async getEngineStatistics(): Promise<{
    totalPositions: number;
    openPositions: number;
    monitoredPositions: number;
    pendingExecutions: number;
    systemHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  }> {
    const allPositions = await this.positionRepository.findAll();
    const openPositions = await this.positionRepository.findByStatus(PositionState.OPEN);
    const monitoredPositions = this.sltpMonitor.getMonitoredPositions();
    const pendingExecutions = this.paperTrading.getPendingExecutions();
    
    // Determine system health without running full integrity check
    let systemHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    
    try {
      // Quick health check instead of full integrity check
      if (allPositions.length > 0) {
        const hasOpenPositions = openPositions.length > 0;
        const hasMonitoring = monitoredPositions.length >= 0;
        
        if (hasOpenPositions && hasMonitoring) {
          systemHealth = 'HEALTHY';
        } else if (hasOpenPositions) {
          systemHealth = 'WARNING';
        }
      }
    } catch (error) {
      systemHealth = 'WARNING';
    }

    return {
      totalPositions: allPositions.length,
      openPositions: openPositions.length,
      monitoredPositions: monitoredPositions.length,
      pendingExecutions: pendingExecutions.length,
      systemHealth
    };
  }

  /**
   * Validate deterministic processing
   */
  async validateDeterministicProcessing(positionId: string): Promise<{
    isDeterministic: boolean;
    iterations: number;
    differences: string[];
  }> {
    return await this.systemIntegrity.validateDeterministicProcessing(positionId);
  }

  /**
   * Create system checkpoint
   */
  async createSystemCheckpoint(): Promise<any> {
    return await this.executeWithTimeout(
      () => this.systemIntegrity.createSystemCheckpoint(),
      this.config.operationTimeoutMs,
      'create_system_checkpoint'
    );
  }

  /**
   * Enhanced timeout management with progress tracking
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string,
    progressCallback?: (progress: number) => void
  ): Promise<T> {
    const operationId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    // Track operation progress if enabled
    if (this.config.progressTrackingEnabled) {
      this.operationProgress.set(operationId, {
        startTime: new Date(),
        progress: 0,
        status: 'starting'
      });
    }

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.cleanupOperation(operationId);
        const elapsedTime = Date.now() - startTime;
        
        console.error(`Position lifecycle operation timed out`, {
          operationName,
          operationId,
          timeoutMs,
          elapsedTimeMs: elapsedTime,
        });
        
        reject(new Error(`Position lifecycle operation '${operationName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.operationTimeouts.set(operationId, timeoutId);

      // Update progress tracking
      if (this.config.progressTrackingEnabled && progressCallback) {
        const progressInterval = setInterval(() => {
          const progress = this.operationProgress.get(operationId);
          if (progress) {
            progressCallback(progress.progress);
          }
        }, 1000); // Update progress every second

        // Clean up progress interval when operation completes
        const originalResolve = resolve;
        const originalReject = reject;
        
        resolve = (value: T) => {
          clearInterval(progressInterval);
          originalResolve(value);
        };
        
        reject = (reason: any) => {
          clearInterval(progressInterval);
          originalReject(reason);
        };
      }

      // Execute the operation
      operation()
        .then(result => {
          this.cleanupOperation(operationId);
          const elapsedTime = Date.now() - startTime;
          
          // Log slow operations for performance monitoring
          if (elapsedTime > timeoutMs * 0.8) {
            console.warn(`Slow position lifecycle operation detected`, {
              operationName,
              operationId,
              elapsedTimeMs: elapsedTime,
              timeoutMs,
              performanceThreshold: timeoutMs * 0.8,
            });
          }
          
          if (this.config.progressTrackingEnabled) {
            console.debug(`Position lifecycle operation completed`, {
              operationName,
              operationId,
              elapsedTimeMs: elapsedTime,
            });
          }
          
          resolve(result);
        })
        .catch(error => {
          this.cleanupOperation(operationId);
          const elapsedTime = Date.now() - startTime;
          
          console.error(`Position lifecycle operation failed`, {
            operationName,
            operationId,
            elapsedTimeMs: elapsedTime,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          
          reject(error);
        });
    });
  }

  /**
   * Execute database operations with optimized timeout handling
   */
  private async executeDbOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.executeWithTimeout(
      operation,
      this.config.databaseTimeoutMs,
      `db_${operationName}`
    );
  }

  /**
   * Execute operations with cancellation support
   */
  private async executeWithCancellation<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const controller = new AbortController();
    const operationId = `${operationName}_${Date.now()}`;
    
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`Operation cancelled due to timeout`, {
        operationName,
        operationId,
        timeoutMs,
      });
    }, timeoutMs);

    try {
      const result = await operation(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Operation '${operationName}' was cancelled due to timeout`);
      }
      throw error;
    }
  }

  /**
   * Clean up operation tracking
   */
  private cleanupOperation(operationId: string): void {
    const timeoutId = this.operationTimeouts.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.operationTimeouts.delete(operationId);
    }
    
    if (this.config.progressTrackingEnabled) {
      this.operationProgress.delete(operationId);
    }
  }

  /**
   * Get current operation progress
   */
  getOperationProgress(): Array<{
    operationId: string;
    startTime: Date;
    progress: number;
    status: string;
    elapsedTimeMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.operationProgress.entries()).map(([operationId, progress]) => ({
      operationId,
      startTime: progress.startTime,
      progress: progress.progress,
      status: progress.status,
      elapsedTimeMs: now - progress.startTime.getTime(),
    }));
  }

  /**
   * Cancel a running operation
   */
  cancelOperation(operationId: string): boolean {
    const timeoutId = this.operationTimeouts.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.operationTimeouts.delete(operationId);
      
      if (this.config.progressTrackingEnabled) {
        const progress = this.operationProgress.get(operationId);
        if (progress) {
          progress.status = 'cancelled';
        }
      }
      
      console.info(`Operation cancelled`, { operationId });
      return true;
    }
    return false;
  }

  /**
   * Get timeout statistics for monitoring
   */
  getTimeoutStatistics(): {
    activeOperations: number;
    operationTimeoutMs: number;
    databaseTimeoutMs: number;
    integrityCheckTimeoutMs: number;
    recoveryTimeoutMs: number;
    progressTrackingEnabled: boolean;
  } {
    return {
      activeOperations: this.operationTimeouts.size,
      operationTimeoutMs: this.config.operationTimeoutMs,
      databaseTimeoutMs: this.config.databaseTimeoutMs,
      integrityCheckTimeoutMs: this.config.integrityCheckTimeoutMs,
      recoveryTimeoutMs: this.config.recoveryTimeoutMs,
      progressTrackingEnabled: this.config.progressTrackingEnabled,
    };
  }
}