/**
 * Paper Trading Service - Realistic simulation with slippage and latency
 */

import { IExecutionTrackingService } from '../interfaces/execution-tracking.interface';
import { 
  PaperTradingConfig, 
  SlippageConfig, 
  LatencyConfig,
  ExecutionData,
  FillData
} from '../types/position-lifecycle.types';

export interface MarketCondition {
  symbol: string;
  volatility: number; // 0-1 scale
  liquidity: number; // 0-1 scale (1 = high liquidity, low slippage)
  spread: number; // Current bid-ask spread
  volume: number; // Recent trading volume
}

export interface SimulatedExecution {
  originalPrice: number;
  simulatedPrice: number;
  slippage: number;
  latencyMs: number;
  partialFill?: {
    filledSize: number;
    remainingSize: number;
  };
  rejected?: boolean;
  rejectionReason?: string;
}

export class PaperTradingService {
  private readonly config: PaperTradingConfig;
  private readonly marketConditions: Map<string, MarketCondition> = new Map();
  private readonly pendingExecutions: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly executionTrackingService: IExecutionTrackingService,
    config?: Partial<PaperTradingConfig>
  ) {
    this.config = {
      slippage: {
        enabled: true,
        maxBasisPoints: 50, // 5 basis points max
        marketImpactFactor: 0.1
      },
      latency: {
        enabled: true,
        minMs: 50,
        maxMs: 200,
        networkJitter: true
      },
      partialFillsEnabled: true,
      rejectionRate: 0.02, // 2% rejection rate
      ...config
    };
  }

  /**
   * Simulate execution with realistic conditions
   */
  async simulateExecution(executionData: ExecutionData): Promise<SimulatedExecution> {
    const symbol = this.extractSymbolFromExecution(executionData);
    const marketCondition = this.getMarketCondition(symbol);

    // Check for rejection first
    if (this.shouldRejectExecution(marketCondition)) {
      return {
        originalPrice: executionData.price,
        simulatedPrice: executionData.price,
        slippage: 0,
        latencyMs: 0,
        rejected: true,
        rejectionReason: 'Market conditions - insufficient liquidity'
      };
    }

    // Calculate slippage
    const slippage = this.calculateSlippage(executionData, marketCondition);
    const simulatedPrice = this.applySlippage(executionData.price, slippage, executionData.executionType);

    // Calculate latency
    const latencyMs = this.calculateLatency(marketCondition);

    // Check for partial fills
    const partialFill = this.shouldPartialFill(executionData, marketCondition);

    const simulation: SimulatedExecution = {
      originalPrice: executionData.price,
      simulatedPrice,
      slippage,
      latencyMs,
      partialFill
    };

    // Execute with simulated conditions
    await this.executeWithSimulation(executionData, simulation);

    return simulation;
  }

  /**
   * Execute with simulated latency and conditions
   */
  private async executeWithSimulation(
    executionData: ExecutionData, 
    simulation: SimulatedExecution
  ): Promise<void> {
    if (simulation.rejected) {
      // Don't execute rejected orders
      return;
    }

    const executeOrder = async () => {
      try {
        if (simulation.partialFill) {
          // Handle partial fill
          const fillData: FillData = {
            orderId: executionData.orderId,
            price: simulation.simulatedPrice,
            size: simulation.partialFill.filledSize,
            executedAt: new Date()
          };

          await this.executionTrackingService.processPartialFill(
            executionData.positionId, 
            fillData
          );

          // Schedule remaining fill if configured
          if (simulation.partialFill.remainingSize > 0) {
            setTimeout(() => {
              const remainingFillData: FillData = {
                orderId: executionData.orderId,
                price: simulation.simulatedPrice,
                size: simulation.partialFill!.remainingSize,
                executedAt: new Date()
              };
              
              this.executionTrackingService.processPartialFill(
                executionData.positionId, 
                remainingFillData
              );
            }, simulation.latencyMs * 2); // Second fill takes longer
          }
        } else {
          // Full execution
          const modifiedExecution: ExecutionData = {
            ...executionData,
            price: simulation.simulatedPrice,
            executedAt: new Date()
          };

          await this.executionTrackingService.recordExecution(modifiedExecution);
        }
      } catch (error) {
        console.error('Simulated execution failed:', error);
      } finally {
        this.pendingExecutions.delete(executionData.orderId);
      }
    };

    // Apply latency delay
    if (simulation.latencyMs > 0) {
      const timeout = setTimeout(executeOrder, simulation.latencyMs);
      this.pendingExecutions.set(executionData.orderId, timeout);
    } else {
      await executeOrder();
    }
  }

  /**
   * Calculate realistic slippage based on market conditions
   */
  private calculateSlippage(executionData: ExecutionData, marketCondition: MarketCondition): number {
    if (!this.config.slippage.enabled) {
      return 0;
    }

    // Base slippage from market conditions
    const liquidityFactor = 1 - marketCondition.liquidity; // Lower liquidity = higher slippage
    const volatilityFactor = marketCondition.volatility; // Higher volatility = higher slippage
    const sizeFactor = Math.log(executionData.size + 1) * this.config.slippage.marketImpactFactor;

    // Calculate slippage in basis points
    const baseSlippage = this.config.slippage.maxBasisPoints * 0.3; // 30% of max as base
    const conditionSlippage = baseSlippage * (liquidityFactor + volatilityFactor);
    const sizeSlippage = baseSlippage * sizeFactor;

    const totalSlippageBps = Math.min(
      baseSlippage + conditionSlippage + sizeSlippage,
      this.config.slippage.maxBasisPoints
    );

    // Add some randomness
    const randomFactor = 0.5 + (Math.random() * 0.5); // 0.5 to 1.0
    
    return totalSlippageBps * randomFactor;
  }

  /**
   * Apply slippage to price based on execution type
   */
  private applySlippage(price: number, slippageBps: number, executionType: string): number {
    const slippageMultiplier = slippageBps / 10000; // Convert basis points to decimal

    // Slippage direction depends on whether we're buying or selling
    // For market orders, slippage is always unfavorable to the trader
    const isBuyExecution = executionType.includes('ENTRY') || executionType.includes('BUY');
    
    if (isBuyExecution) {
      // Buying: price goes up (unfavorable)
      return price * (1 + slippageMultiplier);
    } else {
      // Selling: price goes down (unfavorable)
      return price * (1 - slippageMultiplier);
    }
  }

  /**
   * Calculate realistic latency based on market conditions
   */
  private calculateLatency(marketCondition: MarketCondition): number {
    if (!this.config.latency.enabled) {
      return 0;
    }

    const baseLatency = this.config.latency.minMs;
    const maxAdditionalLatency = this.config.latency.maxMs - this.config.latency.minMs;

    // Higher volatility and lower liquidity increase latency
    const conditionFactor = (marketCondition.volatility + (1 - marketCondition.liquidity)) / 2;
    const additionalLatency = maxAdditionalLatency * conditionFactor;

    let totalLatency = baseLatency + additionalLatency;

    // Add network jitter if enabled
    if (this.config.latency.networkJitter) {
      const jitter = (Math.random() - 0.5) * 0.2 * totalLatency; // ±10% jitter
      totalLatency += jitter;
    }

    return Math.max(0, Math.round(totalLatency));
  }

  /**
   * Determine if execution should be partially filled
   */
  private shouldPartialFill(executionData: ExecutionData, marketCondition: MarketCondition): {
    filledSize: number;
    remainingSize: number;
  } | undefined {
    if (!this.config.partialFillsEnabled) {
      return undefined;
    }

    // Larger orders and lower liquidity increase chance of partial fills
    const sizeFactor = Math.min(executionData.size / 100000, 1); // Normalize to 100k units
    const liquidityFactor = 1 - marketCondition.liquidity;
    
    const partialFillProbability = (sizeFactor + liquidityFactor) / 2;

    if (Math.random() < partialFillProbability * 0.3) { // Max 30% chance
      const fillPercentage = 0.3 + (Math.random() * 0.4); // 30-70% fill
      const filledSize = Math.floor(executionData.size * fillPercentage);
      const remainingSize = executionData.size - filledSize;

      return { filledSize, remainingSize };
    }

    return undefined;
  }

  /**
   * Determine if execution should be rejected
   */
  private shouldRejectExecution(marketCondition: MarketCondition): boolean {
    // Base rejection rate plus market condition factors
    const baseRejectionRate = this.config.rejectionRate;
    const volatilityFactor = marketCondition.volatility * 0.02; // Up to 2% additional
    const liquidityFactor = (1 - marketCondition.liquidity) * 0.03; // Up to 3% additional

    const totalRejectionRate = baseRejectionRate + volatilityFactor + liquidityFactor;

    return Math.random() < totalRejectionRate;
  }

  /**
   * Update market conditions for a symbol
   */
  updateMarketCondition(symbol: string, condition: Partial<MarketCondition>): void {
    const existing = this.marketConditions.get(symbol) || {
      symbol,
      volatility: 0.5,
      liquidity: 0.8,
      spread: 0.0001,
      volume: 1000000
    };

    this.marketConditions.set(symbol, { ...existing, ...condition });
  }

  /**
   * Get market condition for a symbol
   */
  private getMarketCondition(symbol: string): MarketCondition {
    return this.marketConditions.get(symbol) || {
      symbol,
      volatility: 0.5, // Medium volatility
      liquidity: 0.8,  // High liquidity
      spread: 0.0001,  // 1 pip spread
      volume: 1000000  // Default volume
    };
  }

  /**
   * Extract symbol from execution data
   */
  private extractSymbolFromExecution(executionData: ExecutionData): string {
    // This would extract symbol from position or order data
    // Simplified implementation
    return 'EURUSD'; // Default symbol
  }

  /**
   * Cancel pending execution
   */
  cancelPendingExecution(orderId: string): boolean {
    const timeout = this.pendingExecutions.get(orderId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingExecutions.delete(orderId);
      return true;
    }
    return false;
  }

  /**
   * Get all pending executions
   */
  getPendingExecutions(): string[] {
    return Array.from(this.pendingExecutions.keys());
  }

  /**
   * Simulate market impact for large orders
   */
  simulateMarketImpact(symbol: string, orderSize: number): {
    priceImpact: number;
    temporaryImpact: number;
    permanentImpact: number;
  } {
    const marketCondition = this.getMarketCondition(symbol);
    
    // Calculate impact based on order size relative to average volume
    const sizeRatio = orderSize / marketCondition.volume;
    const liquidityAdjustment = 1 - marketCondition.liquidity;
    
    const temporaryImpact = sizeRatio * liquidityAdjustment * 0.001; // 0.1% max temporary
    const permanentImpact = temporaryImpact * 0.3; // 30% becomes permanent
    const priceImpact = temporaryImpact + permanentImpact;

    return {
      priceImpact,
      temporaryImpact,
      permanentImpact
    };
  }

  /**
   * Get simulation statistics
   */
  getSimulationStats(): {
    totalExecutions: number;
    averageSlippage: number;
    averageLatency: number;
    rejectionRate: number;
    partialFillRate: number;
  } {
    // This would track statistics over time
    // Placeholder implementation
    return {
      totalExecutions: 0,
      averageSlippage: 0,
      averageLatency: 0,
      rejectionRate: 0,
      partialFillRate: 0
    };
  }
}