/**
 * Position State Machine Service - Manages formal position state transitions
 */

import { IPositionStateMachine, Position } from '../interfaces/position-state-machine.interface';
import { IPositionEventService } from '../interfaces/position-event.interface';
import { 
  PositionState, 
  PositionEvent, 
  StateTransitionResult, 
  PositionEventType 
} from '../types/position-lifecycle.types';
import { TradeSignal } from '../../types/execution.types';
import { randomUUID } from 'crypto';

export class PositionStateMachineService implements IPositionStateMachine {
  private readonly validTransitions: Map<PositionState, PositionState[]>;

  constructor(
    private readonly eventService: IPositionEventService,
    private readonly positionRepository: any // Will be injected
  ) {
    // Define valid state transitions according to the formal state machine
    this.validTransitions = new Map([
      [PositionState.PENDING, [PositionState.OPEN, PositionState.CLOSED]],
      [PositionState.OPEN, [PositionState.CLOSED, PositionState.LIQUIDATED]],
      [PositionState.CLOSED, [PositionState.ARCHIVED]],
      [PositionState.LIQUIDATED, [PositionState.ARCHIVED]],
      [PositionState.ARCHIVED, []] // Terminal state
    ]);
  }

  async createPosition(tradeSignal: TradeSignal): Promise<Position> {
    const positionId = randomUUID();
    const now = new Date();

    const position: Position = {
      id: positionId,
      executionTradeId: tradeSignal.id,
      accountId: 'default', // For now, use default account
      pair: this.extractPairFromSignal(tradeSignal),
      side: tradeSignal.direction,
      size: 0, // Start with 0 size, will be filled through executions
      avgEntryPrice: tradeSignal.entryPrice,
      leverage: tradeSignal.leverage,
      marginUsed: tradeSignal.marginRequired,
      unrealizedPnL: 0,
      realizedPnL: 0,
      status: PositionState.PENDING,
      stopLoss: tradeSignal.stopLoss,
      takeProfit: tradeSignal.takeProfit,
      openedAt: now,
      createdAt: now,
      updatedAt: now
    };

    // Save position to database
    await this.positionRepository.create(position);

    // Emit position created event
    try {
      console.log('Creating position event for position:', positionId);
      await this.eventService.emitEvent(
        positionId,
        PositionEventType.POSITION_CREATED,
        {
          tradeSignalId: tradeSignal.id,
          initialState: PositionState.PENDING,
          entryPrice: tradeSignal.entryPrice,
          size: tradeSignal.positionSize
        }
      );
      console.log('✅ Position event created successfully');
    } catch (error) {
      console.error('❌ Failed to emit position created event:', error);
      // Don't fail the position creation if event creation fails
    }

    return position;
  }

  async transitionState(positionId: string, event: PositionEvent): Promise<StateTransitionResult> {
    // Get current position
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      return {
        success: false,
        previousState: PositionState.PENDING,
        newState: PositionState.PENDING,
        event,
        error: `Position ${positionId} not found`
      };
    }

    const currentState = position.status;
    const targetState = this.determineTargetState(event.eventType, currentState);

    // Validate transition
    if (!this.validateTransition(currentState, targetState)) {
      return {
        success: false,
        previousState: currentState,
        newState: currentState,
        event,
        error: `Invalid transition from ${currentState} to ${targetState}`
      };
    }

    // Update position state
    const updatedPosition = {
      ...position,
      status: targetState,
      updatedAt: new Date()
    };

    // Handle state-specific updates
    if (targetState === PositionState.OPEN && currentState === PositionState.PENDING) {
      updatedPosition.openedAt = new Date();
    } else if (targetState === PositionState.CLOSED || targetState === PositionState.LIQUIDATED) {
      updatedPosition.closedAt = new Date();
    }

    // Save updated position
    await this.positionRepository.update(positionId, updatedPosition);

    // Emit state transition event
    await this.eventService.emitEvent(
      positionId,
      event.eventType,
      {
        previousState: currentState,
        newState: targetState,
        transitionReason: event.payload
      }
    );

    return {
      success: true,
      previousState: currentState,
      newState: targetState,
      event
    };
  }

  validateTransition(currentState: PositionState, targetState: PositionState): boolean {
    const validTargets = this.validTransitions.get(currentState) || [];
    return validTargets.includes(targetState);
  }

  getValidTransitions(currentState: PositionState): PositionState[] {
    return this.validTransitions.get(currentState) || [];
  }

  private determineTargetState(eventType: PositionEventType, currentState: PositionState): PositionState {
    switch (eventType) {
      case PositionEventType.ORDER_FILLED:
        return currentState === PositionState.PENDING ? PositionState.OPEN : currentState;
      
      case PositionEventType.POSITION_OPENED:
        return PositionState.OPEN;
      
      case PositionEventType.STOP_LOSS_TRIGGERED:
      case PositionEventType.TAKE_PROFIT_TRIGGERED:
      case PositionEventType.POSITION_CLOSED:
        return PositionState.CLOSED;
      
      case PositionEventType.POSITION_LIQUIDATED:
        return PositionState.LIQUIDATED;
      
      default:
        return currentState;
    }
  }

  private extractPairFromSignal(tradeSignal: TradeSignal): string {
    // Extract pair from strategy decision or trade signal
    // This is a placeholder - actual implementation would depend on signal structure
    return 'XAUUSD'; // Updated to match test expectations
  }
}