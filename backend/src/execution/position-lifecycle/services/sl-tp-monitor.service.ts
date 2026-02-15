/**
 * Stop Loss and Take Profit Monitoring Service - Enhanced with Priority Queue and Idempotency
 * 
 * Enhanced with:
 * - Real-time market data monitoring for stop loss
 * - Priority queue for stop loss execution
 * - Optimized trigger response time and execution latency
 * - Idempotency guarantees to prevent double-close
 * - Transaction-safe atomic closure operations
 * 
 * Requirements: 1.1.1, 1.1.2, 1.1.3, 1.3.1, 1.3.2, 2.3
 */

import { IExecutionTrackingService } from '../interfaces/execution-tracking.interface';
import { IRiskLedgerService } from '../interfaces/risk-ledger.interface';
import { IPositionEventService } from '../interfaces/position-event.interface';
import { Position } from '../interfaces/position-state-machine.interface';
import { PositionEventType, PositionState } from '../types/position-lifecycle.types';
import { StopLossPriorityQueueService, StopLossTrigger } from './stop-loss-priority-queue.service';
import { TransactionCoordinatorService } from './transaction-coordinator.service';
import { createClient } from '@supabase/supabase-js';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: Date;
}

export interface SLTPTrigger {
  positionId: string;
  triggerType: 'STOP_LOSS' | 'TAKE_PROFIT';
  triggerPrice: number;
  marketPrice: number;
  timestamp: Date;
}

export class SLTPMonitorService {
  private readonly monitoredPositions: Map<string, Position> = new Map();
  private readonly priceSubscriptions: Map<string, number> = new Map(); // symbol -> latest price
  private readonly priorityQueue: StopLossPriorityQueueService;
  private readonly marketDataBuffer: Map<string, { price: number; timestamp: Date; volume?: number }> = new Map();
  private processingInterval?: NodeJS.Timeout;
  private readonly transactionCoordinator: TransactionCoordinatorService;

  constructor(
    private readonly positionRepository: any, // Will be injected
    private readonly executionTrackingService: IExecutionTrackingService,
    private readonly riskLedgerService: IRiskLedgerService,
    private readonly eventService: IPositionEventService,
    private readonly supabase: ReturnType<typeof createClient>
  ) {
    // Initialize transaction coordinator for atomic operations
    this.transactionCoordinator = new TransactionCoordinatorService(supabase);

    // Initialize priority queue with optimized settings
    this.priorityQueue = new StopLossPriorityQueueService(
      50, // Process every 50ms for faster response
      2000, // Larger queue capacity
      3000 // 3 second timeout per trigger
    );

    // Start continuous processing
    this.startContinuousProcessing();
  }

  /**
   * Start monitoring a position for SL/TP triggers
   */
  async startMonitoring(positionId: string): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      console.warn(`SLTPMonitorService: Position ${positionId} not found, skipping monitoring`);
      return; // Skip missing positions instead of throwing
    }

    if (position.status !== PositionState.OPEN) {
      return; // Only monitor open positions
    }

    this.monitoredPositions.set(positionId, position);
  }

  /**
   * Stop monitoring a position
   */
  stopMonitoring(positionId: string): void {
    this.monitoredPositions.delete(positionId);
  }

  /**
   * Generate idempotency key for position closure
   * Format: close_${positionId}_${timestamp}
   * Requirements: 1.3.1
   */
  private generateIdempotencyKey(positionId: string, timestamp: Date): string {
    const timestampMs = timestamp.getTime();
    return `close_${positionId}_${timestampMs}`;
  }

  /**
   * Check if an idempotency key already exists in position_events
   * Returns true if the key exists (duplicate request)
   * Requirements: 1.3.1, 1.3.2
   */
  private async checkIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('position_events')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .limit(1);

      if (error) {
        console.error('Error checking idempotency key:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Exception checking idempotency key:', error);
      return false;
    }
  }

  /**
   * Update market price and check for triggers
   */
  async updatePrice(priceUpdate: PriceUpdate): Promise<SLTPTrigger[]> {
    // Update price subscriptions and market data buffer
    this.priceSubscriptions.set(priceUpdate.symbol, priceUpdate.price);
    this.marketDataBuffer.set(priceUpdate.symbol, {
      price: priceUpdate.price,
      timestamp: priceUpdate.timestamp
    });

    // Update priority queue with new price
    this.priorityQueue.updateMarketPrice(priceUpdate.symbol, priceUpdate.price);
    
    const triggers: SLTPTrigger[] = [];
    
    // Check all monitored positions for this symbol
    for (const [positionId, position] of this.monitoredPositions) {
      if (this.getSymbolFromPosition(position) === priceUpdate.symbol) {
        const trigger = await this.checkTriggers(position, priceUpdate.price, priceUpdate.timestamp);
        if (trigger) {
          // Add to priority queue instead of immediate execution
          const queueTriggerId = this.priorityQueue.addTrigger({
            positionId: trigger.positionId,
            symbol: priceUpdate.symbol,
            triggerPrice: trigger.triggerPrice,
            currentPrice: trigger.marketPrice,
            side: position.side as 'BUY' | 'SELL',
            triggeredAt: trigger.timestamp,
            metadata: {
              triggerType: trigger.triggerType,
              positionSize: position.size,
              riskLevel: this.calculateRiskLevel(position, trigger.marketPrice),
              originalTrigger: trigger
            }
          });

          triggers.push(trigger);
          
          // Stop monitoring this position (will be handled by queue)
          this.stopMonitoring(positionId);
        }
      }
    }
    
    return triggers;
  }

  /**
   * Check if current price triggers SL or TP for a position
   */
  private async checkTriggers(
    position: Position, 
    currentPrice: number, 
    timestamp: Date
  ): Promise<SLTPTrigger | null> {
    // Get position with latest SL/TP levels (they might have been updated)
    const latestPosition = await this.positionRepository.findById(position.id);
    if (!latestPosition || latestPosition.status !== PositionState.OPEN) {
      return null;
    }

    const stopLoss = latestPosition.stopLoss;
    const takeProfit = latestPosition.takeProfit;

    if (position.side === 'BUY') {
      // For BUY positions:
      // Stop Loss triggers when price falls to or below SL level
      // Take Profit triggers when price rises to or above TP level
      
      if (stopLoss && currentPrice <= stopLoss) {
        return {
          positionId: position.id,
          triggerType: 'STOP_LOSS',
          triggerPrice: stopLoss,
          marketPrice: currentPrice,
          timestamp
        };
      }
      
      if (takeProfit && currentPrice >= takeProfit) {
        return {
          positionId: position.id,
          triggerType: 'TAKE_PROFIT',
          triggerPrice: takeProfit,
          marketPrice: currentPrice,
          timestamp
        };
      }
    } else {
      // For SELL positions:
      // Stop Loss triggers when price rises to or above SL level
      // Take Profit triggers when price falls to or below TP level
      
      if (stopLoss && currentPrice >= stopLoss) {
        return {
          positionId: position.id,
          triggerType: 'STOP_LOSS',
          triggerPrice: stopLoss,
          marketPrice: currentPrice,
          timestamp
        };
      }
      
      if (takeProfit && currentPrice <= takeProfit) {
        return {
          positionId: position.id,
          triggerType: 'TAKE_PROFIT',
          triggerPrice: takeProfit,
          marketPrice: currentPrice,
          timestamp
        };
      }
    }

    return null;
  }

  /**
   * Execute a triggered SL or TP with idempotency and transaction safety
   * Requirements: 1.1.1, 1.1.2, 1.1.3, 1.3.1, 1.3.2
   */
  private async executeTrigger(trigger: SLTPTrigger): Promise<void> {
    // Generate idempotency key
    const idempotencyKey = this.generateIdempotencyKey(trigger.positionId, trigger.timestamp);

    // Check if this closure has already been processed
    const isDuplicate = await this.checkIdempotencyKey(idempotencyKey);
    if (isDuplicate) {
      console.log(`Position ${trigger.positionId} closure already processed (idempotency key: ${idempotencyKey}). Returning success.`);
      return; // Idempotent: return success for duplicate requests
    }

    try {
      // Execute closure within a transaction for atomicity
      await this.transactionCoordinator.executeInTransaction(async (client) => {
        // Double-check position is still OPEN (within transaction lock)
        const position = await this.positionRepository.findById(trigger.positionId);
        if (!position) {
          throw new Error(`Position ${trigger.positionId} not found`);
        }

        if (position.status !== PositionState.OPEN) {
          console.log(`Position ${trigger.positionId} is already ${position.status}. Skipping closure.`);
          return; // Position already closed
        }

        // Create position event with idempotency key FIRST (before any state changes)
        const eventType = trigger.triggerType === 'STOP_LOSS' 
          ? PositionEventType.STOP_LOSS_TRIGGERED 
          : PositionEventType.TAKE_PROFIT_TRIGGERED;

        await this.eventService.emitEvent(
          trigger.positionId,
          eventType,
          {
            triggerPrice: trigger.triggerPrice,
            marketPrice: trigger.marketPrice,
            timestamp: trigger.timestamp,
            idempotencyKey // Include idempotency key in event
          }
        );

        // Execute the actual closure
        if (trigger.triggerType === 'STOP_LOSS') {
          await this.executionTrackingService.triggerStopLoss(
            trigger.positionId, 
            trigger.marketPrice
          );
        } else {
          await this.executionTrackingService.triggerTakeProfit(
            trigger.positionId, 
            trigger.marketPrice
          );
        }

        // Update account balance with realized PnL
        const updatedPosition = await this.positionRepository.findById(trigger.positionId);
        if (updatedPosition && updatedPosition.realizedPnL !== 0) {
          await this.riskLedgerService.updateAccountBalance({
            accountId: updatedPosition.accountId || 'default',
            amount: updatedPosition.realizedPnL,
            reason: trigger.triggerType === 'STOP_LOSS' ? 'STOP_LOSS_REALIZED' : 'TAKE_PROFIT_REALIZED',
            positionId: trigger.positionId
          });
        }

        console.log(`Successfully executed ${trigger.triggerType} for position ${trigger.positionId} with idempotency key ${idempotencyKey}`);
      }, {
        isolationLevel: 'READ COMMITTED',
        timeoutMs: 5000,
        maxRetries: 3
      });

    } catch (error) {
      console.error(`Failed to execute ${trigger.triggerType} for position ${trigger.positionId}:`, error);
      
      // Emit error event (outside transaction since transaction was rolled back)
      try {
        await this.eventService.emitEvent(
          trigger.positionId,
          PositionEventType.POSITION_UPDATED,
          {
            error: `Failed to execute ${trigger.triggerType}`,
            details: error instanceof Error ? error.message : 'Unknown error',
            idempotencyKey
          }
        );
      } catch (eventError) {
        console.error('Failed to emit error event:', eventError);
      }
      
      // Re-throw to be handled by priority queue
      throw error;
    }
  }

  /**
   * Start continuous processing of priority queue
   */
  private startContinuousProcessing(): void {
    this.processingInterval = setInterval(async () => {
      try {
        const result = await this.priorityQueue.processNextTrigger(async (queueTrigger: StopLossTrigger) => {
          // Convert queue trigger back to SLTPTrigger format
          const originalTrigger = queueTrigger.metadata?.originalTrigger;
          if (originalTrigger) {
            await this.executeTrigger(originalTrigger);
          }
        });

        if (result && !result.success) {
          console.warn(`Failed to process trigger ${result.triggerId}: ${result.error}`);
        }
      } catch (error) {
        console.error('Error in continuous processing:', error);
      }
    }, 25); // Process every 25ms for high-frequency processing
  }

  /**
   * Stop continuous processing
   */
  private stopContinuousProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    this.priorityQueue.stopProcessing();
  }

  /**
   * Calculate risk level for priority queue
   */
  private calculateRiskLevel(position: Position, currentPrice: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    const unrealizedPnL = this.calculateUnrealizedPnL(position, currentPrice);
    const positionValue = position.size * position.avgEntryPrice;
    const riskRatio = Math.abs(unrealizedPnL) / positionValue;

    if (riskRatio > 0.1) return 'HIGH'; // 10%+ risk
    if (riskRatio > 0.05) return 'MEDIUM'; // 5%+ risk
    return 'LOW';
  }

  /**
   * Calculate unrealized PnL
   */
  private calculateUnrealizedPnL(position: Position, currentPrice: number): number {
    const priceDiff = position.side === 'BUY' 
      ? currentPrice - position.avgEntryPrice
      : position.avgEntryPrice - currentPrice;
    
    return priceDiff * position.size;
  }

  /**
   * Get priority queue statistics
   */
  getPriorityQueueStats() {
    return this.priorityQueue.getQueueStats();
  }

  /**
   * Get pending triggers for a position
   */
  getPendingTriggersForPosition(positionId: string): StopLossTrigger[] {
    return this.priorityQueue.getPendingTriggers(positionId);
  }

  /**
   * Cancel pending triggers for a position
   */
  cancelPendingTriggers(positionId: string): number {
    return this.priorityQueue.cancelTriggersForPosition(positionId);
  }

  /**
   * Optimize queue performance
   */
  optimizeQueue(): number {
    return this.priorityQueue.optimizeQueue();
  }

  /**
   * Get market data buffer for analysis
   */
  getMarketDataBuffer(): Map<string, { price: number; timestamp: Date; volume?: number }> {
    return new Map(this.marketDataBuffer);
  }

  /**
   * Get average trigger response time
   */
  getAverageResponseTime(): number {
    const stats = this.priorityQueue.getQueueStats();
    return stats.averageProcessingTimeMs;
  }

  /**
   * Shutdown the service gracefully
   */
  shutdown(): void {
    this.stopContinuousProcessing();
    this.priorityQueue.clear();
    this.monitoredPositions.clear();
    this.priceSubscriptions.clear();
    this.marketDataBuffer.clear();
  }

  /**
   * Get all currently monitored positions
   */
  getMonitoredPositions(): Position[] {
    return Array.from(this.monitoredPositions.values());
  }

  /**
   * Get current price for a symbol
   */
  getCurrentPrice(symbol: string): number | null {
    return this.priceSubscriptions.get(symbol) || null;
  }

  /**
   * Initialize monitoring for all open positions
   */
  async initializeMonitoring(): Promise<void> {
    try {
      console.log('SLTPMonitorService: Starting initialization...');
      const openPositions = await this.positionRepository.findByStatus(PositionState.OPEN);
      console.log(`SLTPMonitorService: Found ${openPositions.length} open positions`);
      
      let successCount = 0;
      let skipCount = 0;
      
      for (const position of openPositions) {
        if (position.stopLoss || position.takeProfit) {
          console.log(`SLTPMonitorService: Starting monitoring for position ${position.id}`);
          try {
            await this.startMonitoring(position.id);
            successCount++;
          } catch (error) {
            console.warn(`SLTPMonitorService: Failed to start monitoring for position ${position.id}:`, error.message);
            skipCount++;
          }
        }
      }
      
      console.log(`SLTPMonitorService: Initialization completed - ${successCount} positions monitored, ${skipCount} skipped`);
    } catch (error) {
      console.error('SLTPMonitorService: Initialization failed:', error);
      // Don't throw the error - just log it and continue
      // This prevents the engine from hanging during initialization
    }
  }

  /**
   * Update SL/TP levels for a monitored position
   */
  async updateSLTPLevels(
    positionId: string, 
    stopLoss?: number, 
    takeProfit?: number
  ): Promise<void> {
    const position = this.monitoredPositions.get(positionId);
    if (position) {
      // Update the cached position
      const updatedPosition = { ...position };
      if (stopLoss !== undefined) updatedPosition.stopLoss = stopLoss;
      if (takeProfit !== undefined) updatedPosition.takeProfit = takeProfit;
      
      this.monitoredPositions.set(positionId, updatedPosition);
    }

    // Update in database
    const updateData: any = { updatedAt: new Date() };
    if (stopLoss !== undefined) updateData.stopLoss = stopLoss;
    if (takeProfit !== undefined) updateData.takeProfit = takeProfit;
    
    await this.positionRepository.update(positionId, updateData);

    // Emit update event
    await this.eventService.emitEvent(
      positionId,
      PositionEventType.POSITION_UPDATED,
      {
        stopLoss,
        takeProfit,
        reason: 'SL_TP_LEVELS_UPDATED'
      }
    );
  }

  /**
   * Check if a position has SL/TP levels set
   */
  hasSLTPLevels(position: Position): boolean {
    return !!(position.stopLoss || position.takeProfit);
  }

  /**
   * Calculate distance to SL/TP triggers
   */
  calculateTriggerDistances(position: Position, currentPrice: number): {
    stopLossDistance?: number;
    takeProfitDistance?: number;
  } {
    const result: any = {};

    if (position.stopLoss) {
      result.stopLossDistance = Math.abs(currentPrice - position.stopLoss);
    }

    if (position.takeProfit) {
      result.takeProfitDistance = Math.abs(currentPrice - position.takeProfit);
    }

    return result;
  }

  private getSymbolFromPosition(position: Position): string {
    // Extract symbol from position pair
    // This is a simplified implementation - actual logic would depend on position structure
    return position.pair || 'UNKNOWN';
  }

  /**
   * Validate SL/TP levels for a position
   */
  validateSLTPLevels(
    position: Position, 
    stopLoss?: number, 
    takeProfit?: number
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (position.side === 'BUY') {
      if (stopLoss && stopLoss >= position.avgEntryPrice) {
        errors.push('Stop loss must be below entry price for BUY positions');
      }
      if (takeProfit && takeProfit <= position.avgEntryPrice) {
        errors.push('Take profit must be above entry price for BUY positions');
      }
    } else {
      if (stopLoss && stopLoss <= position.avgEntryPrice) {
        errors.push('Stop loss must be above entry price for SELL positions');
      }
      if (takeProfit && takeProfit >= position.avgEntryPrice) {
        errors.push('Take profit must be below entry price for SELL positions');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}