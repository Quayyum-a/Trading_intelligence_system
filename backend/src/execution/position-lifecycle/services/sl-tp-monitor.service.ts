/**
 * Stop Loss and Take Profit Monitoring Service
 */

import { IExecutionTrackingService } from '../interfaces/execution-tracking.interface';
import { IRiskLedgerService } from '../interfaces/risk-ledger.interface';
import { IPositionEventService } from '../interfaces/position-event.interface';
import { Position } from '../interfaces/position-state-machine.interface';
import { PositionEventType, PositionState } from '../types/position-lifecycle.types';

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

  constructor(
    private readonly positionRepository: any, // Will be injected
    private readonly executionTrackingService: IExecutionTrackingService,
    private readonly riskLedgerService: IRiskLedgerService,
    private readonly eventService: IPositionEventService
  ) {}

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
   * Update market price and check for triggers
   */
  async updatePrice(priceUpdate: PriceUpdate): Promise<SLTPTrigger[]> {
    this.priceSubscriptions.set(priceUpdate.symbol, priceUpdate.price);
    
    const triggers: SLTPTrigger[] = [];
    
    // Check all monitored positions for this symbol
    for (const [positionId, position] of this.monitoredPositions) {
      if (this.getSymbolFromPosition(position) === priceUpdate.symbol) {
        const trigger = await this.checkTriggers(position, priceUpdate.price, priceUpdate.timestamp);
        if (trigger) {
          triggers.push(trigger);
          
          // Execute the trigger
          await this.executeTrigger(trigger);
          
          // Stop monitoring this position
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
   * Execute a triggered SL or TP
   */
  private async executeTrigger(trigger: SLTPTrigger): Promise<void> {
    try {
      if (trigger.triggerType === 'STOP_LOSS') {
        await this.executionTrackingService.triggerStopLoss(
          trigger.positionId, 
          trigger.marketPrice
        );
        
        // Emit stop loss triggered event
        await this.eventService.emitEvent(
          trigger.positionId,
          PositionEventType.STOP_LOSS_TRIGGERED,
          {
            triggerPrice: trigger.triggerPrice,
            marketPrice: trigger.marketPrice,
            timestamp: trigger.timestamp
          }
        );
      } else {
        await this.executionTrackingService.triggerTakeProfit(
          trigger.positionId, 
          trigger.marketPrice
        );
        
        // Emit take profit triggered event
        await this.eventService.emitEvent(
          trigger.positionId,
          PositionEventType.TAKE_PROFIT_TRIGGERED,
          {
            triggerPrice: trigger.triggerPrice,
            marketPrice: trigger.marketPrice,
            timestamp: trigger.timestamp
          }
        );
      }

      // Update account balance immediately with realized PnL
      const position = await this.positionRepository.findById(trigger.positionId);
      if (position && position.realizedPnL !== 0) {
        await this.riskLedgerService.updateAccountBalance({
          accountId: position.accountId || 'default',
          amount: position.realizedPnL,
          reason: trigger.triggerType === 'STOP_LOSS' ? 'STOP_LOSS_REALIZED' : 'TAKE_PROFIT_REALIZED',
          positionId: trigger.positionId
        });
      }

    } catch (error) {
      console.error(`Failed to execute ${trigger.triggerType} for position ${trigger.positionId}:`, error);
      
      // Emit error event
      await this.eventService.emitEvent(
        trigger.positionId,
        PositionEventType.POSITION_UPDATED,
        {
          error: `Failed to execute ${trigger.triggerType}`,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      );
    }
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