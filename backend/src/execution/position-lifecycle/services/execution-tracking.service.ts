/**
 * Execution Tracking Service - Records and manages trade executions
 * Enhanced with improved partial fill tracking system
 */

import { IExecutionTrackingService } from '../interfaces/execution-tracking.interface';
import { IPositionStateMachine } from '../interfaces/position-state-machine.interface';
import { IPositionEventService } from '../interfaces/position-event.interface';
import { 
  TradeExecution, 
  ExecutionData, 
  FillData, 
  ExecutionType,
  PositionEventType,
  PositionEvent,
  PositionState
} from '../types/position-lifecycle.types';
import { PartialFillTrackerService, IPartialFillTracker } from './partial-fill-tracker.service';
import { randomUUID } from 'crypto';

export class ExecutionTrackingService implements IExecutionTrackingService {
  private readonly partialFillTracker: IPartialFillTracker;

  constructor(
    private readonly executionRepository: any, // Will be injected
    private readonly positionRepository: any, // Will be injected
    private readonly stateMachine: IPositionStateMachine,
    private readonly eventService: IPositionEventService
  ) {
    // Initialize the enhanced partial fill tracker
    this.partialFillTracker = new PartialFillTrackerService(
      this.executionRepository,
      this.positionRepository
    );
  }

  async recordExecution(execution: ExecutionData): Promise<TradeExecution> {
    const tradeExecution: TradeExecution = {
      id: randomUUID(),
      positionId: execution.positionId,
      orderId: execution.orderId,
      executionType: execution.executionType,
      price: execution.price,
      size: execution.size,
      executedAt: execution.executedAt,
      createdAt: new Date()
    };

    // Save execution to database
    await this.executionRepository.create(tradeExecution);

    // Update position based on execution type
    await this.updatePositionFromExecution(tradeExecution);

    // Emit execution event
    await this.eventService.emitEvent(
      execution.positionId,
      this.getEventTypeFromExecution(execution.executionType),
      {
        executionId: tradeExecution.id,
        executionType: execution.executionType,
        price: execution.price,
        size: execution.size,
        executedAt: execution.executedAt
      }
    );

    return tradeExecution;
  }

  async processPartialFill(positionId: string, fillData: FillData, isEntry: boolean = true): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Determine execution type based on the isEntry parameter and position status
    let executionType: ExecutionType;
    
    if (position.status === PositionState.PENDING) {
      // Position is still pending, this must be an entry fill
      executionType = ExecutionType.ENTRY;
    } else if (position.status === PositionState.OPEN) {
      // Position is open - use the isEntry parameter to determine type
      executionType = isEntry ? ExecutionType.ENTRY : ExecutionType.PARTIAL_EXIT;
    } else {
      throw new Error(`Cannot process partial fill for position in status ${position.status}`);
    }

    // Get the original order size (this would typically come from the order management system)
    // For now, we'll estimate it based on position size and existing fills
    const orderSize = await this.estimateOrderSize(fillData.orderId, position, fillData.size, executionType);

    // Track the partial fill using the enhanced tracker
    const partialFill = await this.partialFillTracker.trackPartialFill(
      positionId, 
      fillData, 
      orderSize, 
      executionType
    );

    // Record the partial fill execution (this will update the position via updatePositionFromExecution)
    const executionData: ExecutionData = {
      positionId,
      orderId: fillData.orderId,
      executionType,
      price: fillData.price,
      size: fillData.size,
      executedAt: fillData.executedAt
    };

    await this.recordExecution(executionData);

    // Check if the order is now complete
    const isOrderComplete = await this.partialFillTracker.isOrderComplete(fillData.orderId);
    
    // If this was an entry fill that opened the position, transition to OPEN state
    if (position.status === PositionState.PENDING && executionType === ExecutionType.ENTRY) {
      const event: PositionEvent = {
        id: randomUUID(),
        positionId,
        eventType: isOrderComplete ? PositionEventType.POSITION_OPENED : PositionEventType.PARTIAL_FILL,
        previousStatus: position.status,
        newStatus: isOrderComplete ? PositionState.OPEN : PositionState.PENDING,
        payload: { 
          fillData, 
          partialFill,
          isOrderComplete,
          remainingSize: await this.partialFillTracker.getRemainingQuantity(fillData.orderId)
        },
        createdAt: new Date()
      };

      if (isOrderComplete) {
        await this.stateMachine.transitionState(positionId, event);
      } else {
        // Just emit the partial fill event without state transition
        await this.eventService.emitEvent(
          positionId,
          PositionEventType.PARTIAL_FILL,
          event.payload
        );
      }
    }

    // Emit detailed partial fill event with tracking information
    await this.eventService.emitEvent(
      positionId,
      PositionEventType.PARTIAL_FILL,
      {
        fillId: partialFill.id,
        orderId: fillData.orderId,
        executionType,
        price: fillData.price,
        size: fillData.size,
        cumulativeSize: partialFill.cumulativeSize,
        remainingSize: partialFill.remainingSize,
        fillSequence: partialFill.fillSequence,
        isOrderComplete,
        executedAt: fillData.executedAt
      }
    );
  }

  async processFullFill(positionId: string, fillData: FillData): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    if (position.status === PositionState.PENDING) {
      // This is an entry fill - open the position
      const executionData: ExecutionData = {
        positionId,
        orderId: fillData.orderId,
        executionType: ExecutionType.ENTRY,
        price: fillData.price,
        size: fillData.size,
        executedAt: fillData.executedAt
      };

      await this.recordExecution(executionData);

      // Update position to open with the fill size
      await this.positionRepository.update(positionId, {
        size: fillData.size,
        avgEntryPrice: fillData.price,
        updatedAt: new Date()
      });

      // Transition to OPEN
      const event: PositionEvent = {
        id: randomUUID(),
        positionId,
        eventType: PositionEventType.POSITION_OPENED,
        previousStatus: position.status,
        newStatus: PositionState.OPEN,
        payload: { fillData },
        createdAt: new Date()
      };

      await this.stateMachine.transitionState(positionId, event);
    } else {
      // This is an exit fill - close the position
      const executionData: ExecutionData = {
        positionId,
        orderId: fillData.orderId,
        executionType: ExecutionType.FULL_EXIT,
        price: fillData.price,
        size: fillData.size,
        executedAt: fillData.executedAt
      };

      await this.recordExecution(executionData);

      // Calculate realized PnL
      const realizedPnL = this.calculateRealizedPnL(position, fillData);

      // Update position to closed
      await this.positionRepository.update(positionId, {
        size: 0,
        realizedPnL: position.realizedPnL + realizedPnL,
        closedAt: fillData.executedAt,
        updatedAt: new Date()
      });

      // Update account balance with realized PnL
      if (realizedPnL !== 0) {
        const accountId = position.accountId || 'default';
        // We need access to the risk ledger service to update balance
        // For now, this will be handled by the main engine
      }

      // Transition to CLOSED
      const event: PositionEvent = {
        id: randomUUID(),
        positionId,
        eventType: PositionEventType.POSITION_CLOSED,
        previousStatus: position.status,
        newStatus: PositionState.CLOSED,
        payload: { fillData, realizedPnL },
        createdAt: new Date()
      };

      await this.stateMachine.transitionState(positionId, event);
    }
  }

  async triggerStopLoss(positionId: string, marketPrice: number): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Create stop loss execution
    const executionData: ExecutionData = {
      positionId,
      orderId: randomUUID(), // Generate order ID for SL
      executionType: ExecutionType.STOP_LOSS,
      price: marketPrice,
      size: position.size,
      executedAt: new Date()
    };

    await this.recordExecution(executionData);

    // Calculate realized PnL
    const realizedPnL = this.calculateRealizedPnL(position, {
      orderId: executionData.orderId,
      price: marketPrice,
      size: position.size,
      executedAt: new Date()
    });

    // Update position
    await this.positionRepository.update(positionId, {
      size: 0,
      realizedPnL: position.realizedPnL + realizedPnL,
      closedAt: new Date(),
      updatedAt: new Date()
    });

    // Transition to CLOSED
    const event: PositionEvent = {
      id: randomUUID(),
      positionId,
      eventType: PositionEventType.STOP_LOSS_TRIGGERED,
      previousStatus: position.status,
      newStatus: PositionState.CLOSED,
      payload: { marketPrice, realizedPnL },
      createdAt: new Date()
    };

    await this.stateMachine.transitionState(positionId, event);
  }

  async triggerTakeProfit(positionId: string, marketPrice: number): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Create take profit execution
    const executionData: ExecutionData = {
      positionId,
      orderId: randomUUID(), // Generate order ID for TP
      executionType: ExecutionType.TAKE_PROFIT,
      price: marketPrice,
      size: position.size,
      executedAt: new Date()
    };

    await this.recordExecution(executionData);

    // Calculate realized PnL
    const realizedPnL = this.calculateRealizedPnL(position, {
      orderId: executionData.orderId,
      price: marketPrice,
      size: position.size,
      executedAt: new Date()
    });

    // Update position
    await this.positionRepository.update(positionId, {
      size: 0,
      realizedPnL: position.realizedPnL + realizedPnL,
      closedAt: new Date(),
      updatedAt: new Date()
    });

    // Transition to CLOSED
    const event: PositionEvent = {
      id: randomUUID(),
      positionId,
      eventType: PositionEventType.TAKE_PROFIT_TRIGGERED,
      previousStatus: position.status,
      newStatus: PositionState.CLOSED,
      payload: { marketPrice, realizedPnL },
      createdAt: new Date()
    };

    await this.stateMachine.transitionState(positionId, event);
  }

  private async updatePositionFromExecution(execution: TradeExecution): Promise<void> {
    const position = await this.positionRepository.findById(execution.positionId);
    if (!position) return;

    switch (execution.executionType) {
      case ExecutionType.ENTRY:
        // Update average entry price and size
        const newAvgPrice = this.calculateNewAveragePrice(
          position.avgEntryPrice,
          position.size,
          execution.price,
          execution.size
        );
        
        await this.positionRepository.update(execution.positionId, {
          size: Math.round((position.size + execution.size) * 100) / 100, // Round to avoid precision issues
          avgEntryPrice: newAvgPrice,
          updatedAt: new Date()
        });
        break;

      case ExecutionType.PARTIAL_EXIT:
        await this.positionRepository.update(execution.positionId, {
          size: Math.round((position.size - execution.size) * 100) / 100, // Round to avoid precision issues
          updatedAt: new Date()
        });
        break;
    }
  }

  private calculateNewAveragePrice(
    currentAvgPrice: number,
    currentSize: number,
    newPrice: number,
    newSize: number
  ): number {
    if (currentSize === 0) return newPrice;
    
    const totalValue = (currentAvgPrice * currentSize) + (newPrice * newSize);
    const totalSize = currentSize + newSize;
    
    // Round to avoid floating point precision issues
    return Math.round((totalValue / totalSize) * 100) / 100;
  }

  private calculateRealizedPnL(position: any, fillData: FillData): number {
    const priceDiff = position.side === 'BUY' 
      ? fillData.price - position.avgEntryPrice
      : position.avgEntryPrice - fillData.price;
    
    return priceDiff * fillData.size;
  }

  private getEventTypeFromExecution(executionType: ExecutionType): PositionEventType {
    switch (executionType) {
      case ExecutionType.ENTRY:
        return PositionEventType.ORDER_FILLED;
      case ExecutionType.PARTIAL_EXIT:
        return PositionEventType.PARTIAL_FILL;
      case ExecutionType.FULL_EXIT:
        return PositionEventType.POSITION_CLOSED;
      case ExecutionType.STOP_LOSS:
        return PositionEventType.STOP_LOSS_TRIGGERED;
      case ExecutionType.TAKE_PROFIT:
        return PositionEventType.TAKE_PROFIT_TRIGGERED;
      case ExecutionType.LIQUIDATION:
        return PositionEventType.POSITION_LIQUIDATED;
      default:
        return PositionEventType.POSITION_UPDATED;
    }
  }

  /**
   * Estimate order size based on available information
   * This is a fallback when order size is not directly available
   */
  private async estimateOrderSize(
    orderId: string, 
    position: any, 
    fillSize: number, 
    executionType: ExecutionType
  ): Promise<number> {
    // First check if we already have an order tracker
    const existingTracker = await this.partialFillTracker.getOrderTracker(orderId);
    if (existingTracker) {
      return existingTracker.originalSize;
    }

    // Estimate based on execution type and position
    switch (executionType) {
      case ExecutionType.ENTRY:
        // For entry orders, use a reasonable estimate that allows for multiple fills
        // Use at least 2x the fill size to allow for partial fills
        return position.status === PositionState.PENDING 
          ? Math.max(fillSize * 2, position.size || fillSize * 2)
          : fillSize * 2; // Conservative estimate for additional entries

      case ExecutionType.PARTIAL_EXIT:
        // For exit orders, the order size is typically the current position size or less
        return Math.max(position.size, fillSize * 2); // Conservative estimate

      default:
        // Default to double the fill size to allow for partial fills
        return fillSize * 2;
    }
  }

  /**
   * Get partial fill tracker for external access
   */
  getPartialFillTracker(): IPartialFillTracker {
    return this.partialFillTracker;
  }

  /**
   * Get fill aggregation for an order
   */
  async getOrderFillAggregation(orderId: string) {
    return await this.partialFillTracker.getOrderAggregation(orderId);
  }

  /**
   * Get remaining quantity for an order
   */
  async getRemainingOrderQuantity(orderId: string): Promise<number> {
    return await this.partialFillTracker.getRemainingQuantity(orderId);
  }

  /**
   * Check if an order is completely filled
   */
  async isOrderCompletelyFilled(orderId: string): Promise<boolean> {
    return await this.partialFillTracker.isOrderComplete(orderId);
  }

  /**
   * Validate fill consistency for an order
   */
  async validateOrderFillConsistency(orderId: string): Promise<{
    isConsistent: boolean;
    issues: string[];
  }> {
    const orderTracker = await this.partialFillTracker.getOrderTracker(orderId);
    if (!orderTracker) {
      return {
        isConsistent: false,
        issues: [`No order tracker found for order ${orderId}`]
      };
    }

    const fills = await this.partialFillTracker.getOrderFills(orderId);
    const issues: string[] = [];

    // Check fill sequence consistency
    for (let i = 0; i < fills.length; i++) {
      const fill = fills[i];
      if (fill.fillSequence !== i + 1) {
        issues.push(`Fill sequence mismatch at index ${i}: expected ${i + 1}, got ${fill.fillSequence}`);
      }
    }

    // Check cumulative size consistency
    let expectedCumulative = 0;
    for (const fill of fills) {
      expectedCumulative += fill.size;
      if (Math.abs(fill.cumulativeSize - expectedCumulative) > 0.001) {
        issues.push(`Cumulative size mismatch for fill ${fill.id}: expected ${expectedCumulative}, got ${fill.cumulativeSize}`);
      }
    }

    // Check remaining size consistency
    const lastFill = fills[fills.length - 1];
    if (lastFill) {
      const expectedRemaining = orderTracker.originalSize - lastFill.cumulativeSize;
      if (Math.abs(lastFill.remainingSize - expectedRemaining) > 0.001) {
        issues.push(`Remaining size mismatch: expected ${expectedRemaining}, got ${lastFill.remainingSize}`);
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues
    };
  }
}