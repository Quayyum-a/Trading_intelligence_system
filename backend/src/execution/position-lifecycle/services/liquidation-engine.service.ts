/**
 * Liquidation Engine Service - Handles forced liquidation with margin monitoring
 */

import { IRiskLedgerService } from '../interfaces/risk-ledger.interface';
import { IPositionEventService } from '../interfaces/position-event.interface';
import { IExecutionTrackingService } from '../interfaces/execution-tracking.interface';
import { 
  LiquidationResult, 
  MarginStatus, 
  PositionEventType,
  ExecutionType,
  PositionState
} from '../types/position-lifecycle.types';
import { Position } from '../interfaces/position-state-machine.interface';

export interface LiquidationConfig {
  marginCallLevel: number; // Margin level that triggers margin call warning
  liquidationLevel: number; // Margin level that triggers forced liquidation
  maxSlippagePercent: number; // Maximum slippage applied during liquidation
  liquidationFeePercent: number; // Additional fee for liquidation
  monitoringIntervalMs: number; // How often to check margin levels
}

export interface LiquidationCandidate {
  accountId: string;
  marginLevel: number;
  positions: Position[];
  totalUnrealizedLoss: number;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class LiquidationEngineService {
  private readonly config: LiquidationConfig;
  private monitoringTimer: NodeJS.Timeout | null = null; // Remove readonly
  private readonly liquidationQueue: Set<string> = new Set(); // Accounts being liquidated

  constructor(
    private readonly riskLedgerService: IRiskLedgerService,
    private readonly positionRepository: any, // Will be injected
    private readonly accountRepository: any, // Will be injected
    private readonly executionTrackingService: IExecutionTrackingService,
    private readonly eventService: IPositionEventService,
    config?: Partial<LiquidationConfig>
  ) {
    this.config = {
      marginCallLevel: 0.5, // 50%
      liquidationLevel: 0.2, // 20%
      maxSlippagePercent: 5.0, // 5%
      liquidationFeePercent: 0.5, // 0.5%
      monitoringIntervalMs: 5000, // 5 seconds
      ...config
    };
  }

  /**
   * Start continuous margin monitoring
   */
  startMonitoring(): void {
    if (this.monitoringTimer) {
      return; // Already monitoring
    }

    console.log('LiquidationEngine: Starting margin monitoring...');
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.checkAllAccountMargins();
      } catch (error) {
        console.error('LiquidationEngine: Error during margin check:', error);
      }
    }, this.config.monitoringIntervalMs);
    console.log('LiquidationEngine: Margin monitoring started');
  }

  /**
   * Stop margin monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringTimer) {
      console.log('LiquidationEngine: Stopping margin monitoring...');
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      console.log('LiquidationEngine: Margin monitoring stopped');
    }
  }

  /**
   * Check margin levels for all accounts
   */
  async checkAllAccountMargins(): Promise<LiquidationCandidate[]> {
    try {
      const accounts = await this.accountRepository.findAll();
      const candidates: LiquidationCandidate[] = [];

      for (const account of accounts) {
        try {
          const marginStatus = await this.riskLedgerService.checkMarginRequirements(account.id);
          
          if (marginStatus.isLiquidation && !this.liquidationQueue.has(account.id)) {
            // Immediate liquidation required
            this.liquidationQueue.add(account.id);
            await this.executeLiquidation(account.id);
          } else if (marginStatus.isMarginCall) {
            // Margin call - add to candidates for monitoring
            const positions = await this.positionRepository.findByAccountIdAndStatus(account.id, PositionState.OPEN);
            const candidate = await this.createLiquidationCandidate(account.id, marginStatus, positions);
            candidates.push(candidate);
          }
        } catch (error) {
          console.error(`Error checking margin for account ${account.id}:`, error);
        }
      }

      return candidates;
    } catch (error) {
      console.error('Error in checkAllAccountMargins:', error);
      return [];
    }
  }

  /**
   * Execute forced liquidation for an account
   */
  async executeLiquidation(accountId: string): Promise<LiquidationResult> {
    try {
      console.log(`Starting liquidation for account ${accountId}`);

      // Get all open positions for the account
      const openPositions = await this.positionRepository.findByAccountIdAndStatus(accountId, PositionState.OPEN);

      if (openPositions.length === 0) {
        this.liquidationQueue.delete(accountId);
        return {
          accountId,
          positionsLiquidated: [],
          totalLoss: 0,
          marginReleased: 0,
          timestamp: new Date()
        };
      }

      // Sort positions by loss (highest loss first) for liquidation priority
      const sortedPositions = this.sortPositionsByLoss(openPositions);

      let totalLoss = 0;
      let marginReleased = 0;
      const liquidatedPositions: string[] = [];

      // Liquidate positions one by one until margin requirements are met
      for (const position of sortedPositions) {
        try {
          const liquidationResult = await this.liquidatePosition(position);
          
          totalLoss += liquidationResult.loss;
          marginReleased += liquidationResult.marginReleased;
          liquidatedPositions.push(position.id);

          // Check if liquidation resolved the margin issue
          const marginStatus = await this.riskLedgerService.checkMarginRequirements(accountId);
          if (!marginStatus.isLiquidation) {
            console.log(`Liquidation resolved for account ${accountId} after ${liquidatedPositions.length} positions`);
            break;
          }
        } catch (error) {
          console.error(`Failed to liquidate position ${position.id}:`, error);
          // Continue with next position
        }
      }

      // Update account balance with total liquidation loss
      if (totalLoss > 0) {
        await this.riskLedgerService.updateAccountBalance({
          accountId,
          amount: -totalLoss,
          reason: 'LIQUIDATION_LOSS'
        });
      }

      // Emit liquidation completed event
      await this.eventService.emitEvent(
        accountId, // Using accountId as position ID for account-level events
        PositionEventType.POSITION_LIQUIDATED,
        {
          accountId,
          positionsLiquidated: liquidatedPositions,
          totalLoss,
          marginReleased,
          liquidationType: 'FORCED_LIQUIDATION'
        }
      );

      this.liquidationQueue.delete(accountId);

      return {
        accountId,
        positionsLiquidated: liquidatedPositions,
        totalLoss,
        marginReleased,
        timestamp: new Date()
      };

    } catch (error) {
      console.error(`Liquidation failed for account ${accountId}:`, error);
      this.liquidationQueue.delete(accountId);
      throw error;
    }
  }

  /**
   * Liquidate a single position
   */
  private async liquidatePosition(position: Position): Promise<{
    loss: number;
    marginReleased: number;
  }> {
    // Calculate liquidation price with slippage
    const liquidationPrice = this.calculateLiquidationPrice(position);

    // Calculate liquidation loss
    const loss = this.calculateLiquidationLoss(position, liquidationPrice);

    // Add liquidation fee
    const liquidationFee = Math.abs(loss) * (this.config.liquidationFeePercent / 100);
    const totalLoss = Math.abs(loss) + liquidationFee;

    // Record liquidation execution
    await this.executionTrackingService.recordExecution({
      positionId: position.id,
      orderId: `LIQ_${Date.now()}_${position.id.slice(-8)}`,
      executionType: ExecutionType.LIQUIDATION,
      price: liquidationPrice,
      size: position.size,
      executedAt: new Date()
    });

    // Update position to liquidated status
    await this.positionRepository.update(position.id, {
      status: 'LIQUIDATED',
      size: 0,
      realizedPnL: position.realizedPnL - totalLoss,
      closedAt: new Date(),
      updatedAt: new Date()
    });

    // Release margin
    await this.riskLedgerService.releaseMargin(position.id, position.marginUsed);

    // Emit position liquidated event
    await this.eventService.emitEvent(
      position.id,
      PositionEventType.POSITION_LIQUIDATED,
      {
        liquidationPrice,
        loss: totalLoss,
        liquidationFee,
        marginReleased: position.marginUsed
      }
    );

    return {
      loss: totalLoss,
      marginReleased: position.marginUsed
    };
  }

  /**
   * Sort positions by loss for liquidation priority (highest loss first)
   */
  private sortPositionsByLoss(positions: Position[]): Position[] {
    return positions
      .map(position => ({
        ...position,
        currentLoss: Math.min(0, position.unrealizedPnL) // Only negative PnL counts as loss
      }))
      .sort((a, b) => a.currentLoss - b.currentLoss) // Sort by loss (most negative first)
      .map(({ currentLoss, ...position }) => position); // Remove temporary field
  }

  /**
   * Calculate liquidation price with slippage
   */
  private calculateLiquidationPrice(position: Position): number {
    const slippageMultiplier = 1 + (this.config.maxSlippagePercent / 100);
    
    if (position.side === 'BUY') {
      // For BUY positions, liquidation price is lower (worse for the trader)
      return position.avgEntryPrice * (1 - (this.config.maxSlippagePercent / 100));
    } else {
      // For SELL positions, liquidation price is higher (worse for the trader)
      return position.avgEntryPrice * slippageMultiplier;
    }
  }

  /**
   * Calculate loss from liquidation
   */
  private calculateLiquidationLoss(position: Position, liquidationPrice: number): number {
    const priceDiff = position.side === 'BUY' 
      ? liquidationPrice - position.avgEntryPrice
      : position.avgEntryPrice - liquidationPrice;
    
    return priceDiff * position.size;
  }

  /**
   * Create liquidation candidate from margin status
   */
  private async createLiquidationCandidate(
    accountId: string, 
    marginStatus: MarginStatus, 
    positions: Position[]
  ): Promise<LiquidationCandidate> {
    const totalUnrealizedLoss = positions.reduce((sum, pos) => 
      sum + Math.min(0, pos.unrealizedPnL), 0
    );

    let urgency: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    
    if (marginStatus.marginLevel < this.config.liquidationLevel * 1.1) {
      urgency = 'HIGH';
    } else if (marginStatus.marginLevel < this.config.marginCallLevel * 1.2) {
      urgency = 'MEDIUM';
    }

    return {
      accountId,
      marginLevel: marginStatus.marginLevel,
      positions,
      totalUnrealizedLoss,
      urgency
    };
  }

  /**
   * Get liquidation status for an account
   */
  async getLiquidationStatus(accountId: string): Promise<{
    isBeingLiquidated: boolean;
    marginStatus: MarginStatus;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }> {
    const marginStatus = await this.riskLedgerService.checkMarginRequirements(accountId);
    
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    
    if (marginStatus.isLiquidation) {
      riskLevel = 'CRITICAL';
    } else if (marginStatus.marginLevel < this.config.liquidationLevel * 1.1) {
      riskLevel = 'HIGH';
    } else if (marginStatus.isMarginCall) {
      riskLevel = 'MEDIUM';
    }

    return {
      isBeingLiquidated: this.liquidationQueue.has(accountId),
      marginStatus,
      riskLevel
    };
  }

  /**
   * Estimate liquidation impact for an account
   */
  async estimateLiquidationImpact(accountId: string): Promise<{
    estimatedLoss: number;
    positionsAtRisk: number;
    marginToBeReleased: number;
  }> {
    const positions = await this.positionRepository.findByAccountIdAndStatus(accountId, PositionState.OPEN);
    
    let estimatedLoss = 0;
    let marginToBeReleased = 0;
    
    for (const position of positions) {
      const liquidationPrice = this.calculateLiquidationPrice(position);
      const loss = Math.abs(this.calculateLiquidationLoss(position, liquidationPrice));
      const liquidationFee = loss * (this.config.liquidationFeePercent / 100);
      
      estimatedLoss += loss + liquidationFee;
      marginToBeReleased += position.marginUsed;
    }

    return {
      estimatedLoss,
      positionsAtRisk: positions.length,
      marginToBeReleased
    };
  }

  /**
   * Check if an account is eligible for liquidation
   */
  async isEligibleForLiquidation(accountId: string): Promise<boolean> {
    const marginStatus = await this.riskLedgerService.checkMarginRequirements(accountId);
    return marginStatus.isLiquidation && !this.liquidationQueue.has(accountId);
  }
}