/**
 * Position Event Service - Handles event sourcing and audit trails
 */

import { IPositionEventService } from '../interfaces/position-event.interface';
import { Position } from '../interfaces/position-state-machine.interface';
import { PositionEvent, PositionEventType, PositionState } from '../types/position-lifecycle.types';
import { randomUUID } from 'crypto';

export class PositionEventService implements IPositionEventService {
  constructor(
    private readonly eventRepository: any, // Will be injected
    private readonly positionRepository: any // Will be injected
  ) {}

  async emitEvent(positionId: string, eventType: PositionEventType, payload: any): Promise<void> {
    const event: PositionEvent = {
      id: randomUUID(),
      positionId,
      eventType,
      payload,
      createdAt: new Date()
    };

    // Add state information if available in payload
    if (payload.previousState) {
      event.previousStatus = payload.previousState;
    }
    if (payload.newState) {
      event.newStatus = payload.newState;
    }

    // Save event to database
    await this.eventRepository.create(event);
  }

  async replayEvents(positionId: string): Promise<Position> {
    // Get all events for the position in chronological order
    const events = await this.eventRepository.findByPositionId(positionId, { 
      orderBy: 'created_at',
      direction: 'ASC' 
    });

    if (events.length === 0) {
      // If no events exist, try to get the position from the database
      // This handles cases where positions were created without proper event tracking
      const existingPosition = await this.positionRepository.findById(positionId);
      if (existingPosition) {
        return existingPosition;
      }
      throw new Error(`No events found for position ${positionId} and position does not exist in database`);
    }

    // Start with initial position state from first event
    const firstEvent = events[0];
    if (firstEvent.eventType !== PositionEventType.POSITION_CREATED) {
      // If first event is not POSITION_CREATED, try to reconstruct from available events
      console.warn(`First event for position ${positionId} is ${firstEvent.eventType}, not POSITION_CREATED. Attempting reconstruction.`);
    }

    // Initialize position from creation event or first available event
    let position = this.initializePositionFromEvent(positionId, firstEvent);

    // Replay all subsequent events
    for (let i = 1; i < events.length; i++) {
      position = this.applyEventToPosition(position, events[i]);
    }

    return position;
  }

  validateEventSequence(events: PositionEvent[]): boolean {
    if (events.length === 0) {
      return true;
    }

    // Sort events by creation time
    const sortedEvents = [...events].sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    // First event must be POSITION_CREATED
    if (sortedEvents[0].eventType !== PositionEventType.POSITION_CREATED) {
      return false;
    }

    // Validate state transitions
    let currentState = PositionState.PENDING;
    
    for (const event of sortedEvents) {
      const expectedState = this.getExpectedStateFromEvent(event.eventType, currentState);
      
      if (event.newStatus && event.newStatus !== expectedState) {
        return false;
      }

      if (event.previousStatus && event.previousStatus !== currentState) {
        return false;
      }

      // Update current state
      if (event.newStatus) {
        currentState = event.newStatus;
      }
    }

    return true;
  }

  async getEventHistory(positionId: string): Promise<PositionEvent[]> {
    return await this.eventRepository.findByPositionId(positionId, {
      orderBy: 'created_at',
      direction: 'ASC'
    });
  }

  private initializePositionFromEvent(positionId: string, event: PositionEvent): Position {
    const payload = event.payload;
    
    // Handle different event types for initialization
    if (event.eventType === PositionEventType.POSITION_CREATED) {
      return this.initializePositionFromCreationEvent(positionId, event);
    }
    
    // For other event types, create a basic position structure
    return {
      id: positionId,
      executionTradeId: payload.tradeSignalId || payload.executionTradeId || '',
      pair: payload.pair || 'UNKNOWN',
      side: payload.side || 'BUY',
      size: payload.size || 0,
      avgEntryPrice: payload.entryPrice || payload.price || 0,
      leverage: payload.leverage || 1,
      marginUsed: payload.marginUsed || 0,
      unrealizedPnL: payload.unrealizedPnL || 0,
      realizedPnL: payload.realizedPnL || 0,
      status: PositionState.PENDING,
      openedAt: event.createdAt,
      createdAt: event.createdAt,
      updatedAt: event.createdAt
    };
  }
  private initializePositionFromCreationEvent(positionId: string, event: PositionEvent): Position {
    const payload = event.payload;
    
    return {
      id: positionId,
      executionTradeId: payload.tradeSignalId || '',
      pair: payload.pair || 'UNKNOWN',
      side: payload.side || 'BUY',
      size: payload.size || 0,
      avgEntryPrice: payload.entryPrice || 0,
      leverage: payload.leverage || 1,
      marginUsed: payload.marginUsed || 0,
      unrealizedPnL: 0,
      realizedPnL: 0,
      status: PositionState.PENDING,
      openedAt: event.createdAt,
      createdAt: event.createdAt,
      updatedAt: event.createdAt
    };
  }

  private applyEventToPosition(position: Position, event: PositionEvent): Position {
    const updatedPosition = { ...position };
    const payload = event.payload;

    switch (event.eventType) {
      case PositionEventType.ORDER_FILLED:
        if (position.status === PositionState.PENDING) {
          updatedPosition.status = PositionState.OPEN;
          updatedPosition.openedAt = event.createdAt;
        }
        
        // Update size and average price if it's an entry fill
        if (payload.executionType === 'ENTRY') {
          const newSize = position.size + payload.size;
          const newAvgPrice = this.calculateNewAveragePrice(
            position.avgEntryPrice,
            position.size,
            payload.price,
            payload.size
          );
          updatedPosition.size = newSize;
          updatedPosition.avgEntryPrice = newAvgPrice;
        }
        break;

      case PositionEventType.PARTIAL_FILL:
        if (payload.executionType === 'PARTIAL_EXIT') {
          updatedPosition.size = position.size - payload.size;
          updatedPosition.realizedPnL = position.realizedPnL + (payload.realizedPnL || 0);
        }
        break;

      case PositionEventType.POSITION_OPENED:
        updatedPosition.status = PositionState.OPEN;
        updatedPosition.openedAt = event.createdAt;
        break;

      case PositionEventType.STOP_LOSS_TRIGGERED:
      case PositionEventType.TAKE_PROFIT_TRIGGERED:
      case PositionEventType.POSITION_CLOSED:
        updatedPosition.status = PositionState.CLOSED;
        updatedPosition.closedAt = event.createdAt;
        updatedPosition.size = 0;
        updatedPosition.realizedPnL = position.realizedPnL + (payload.realizedPnL || 0);
        break;

      case PositionEventType.POSITION_LIQUIDATED:
        updatedPosition.status = PositionState.LIQUIDATED;
        updatedPosition.closedAt = event.createdAt;
        updatedPosition.size = 0;
        updatedPosition.realizedPnL = position.realizedPnL + (payload.realizedPnL || 0);
        break;

      case PositionEventType.POSITION_UPDATED:
        // Apply any updates from payload
        if (payload.unrealizedPnL !== undefined) {
          updatedPosition.unrealizedPnL = payload.unrealizedPnL;
        }
        break;
    }

    updatedPosition.updatedAt = event.createdAt;
    return updatedPosition;
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
    
    return totalValue / totalSize;
  }

  private getExpectedStateFromEvent(eventType: PositionEventType, currentState: PositionState): PositionState {
    switch (eventType) {
      case PositionEventType.POSITION_CREATED:
        return PositionState.PENDING;
      
      case PositionEventType.ORDER_FILLED:
      case PositionEventType.POSITION_OPENED:
        return currentState === PositionState.PENDING ? PositionState.OPEN : currentState;
      
      case PositionEventType.PARTIAL_FILL:
      case PositionEventType.POSITION_UPDATED:
        return currentState;
      
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

  /**
   * Validate that the current database state matches replayed state
   */
  async validateReplayConsistency(positionId: string): Promise<boolean> {
    try {
      // Get current position from database
      const currentPosition = await this.positionRepository.findById(positionId);
      if (!currentPosition) {
        return false;
      }

      // Replay events to rebuild state
      const replayedPosition = await this.replayEvents(positionId);

      // Compare key fields (allowing for small floating point differences)
      const fieldsMatch = 
        currentPosition.status === replayedPosition.status &&
        Math.abs(currentPosition.size - replayedPosition.size) < 0.0001 &&
        Math.abs(currentPosition.avgEntryPrice - replayedPosition.avgEntryPrice) < 0.0001 &&
        Math.abs(currentPosition.realizedPnL - replayedPosition.realizedPnL) < 0.01;

      return fieldsMatch;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get events by type for a position
   */
  async getEventsByType(positionId: string, eventType: PositionEventType): Promise<PositionEvent[]> {
    return await this.eventRepository.findByPositionIdAndType(positionId, eventType);
  }

  /**
   * Get the latest event for a position
   */
  async getLatestEvent(positionId: string): Promise<PositionEvent | null> {
    const events = await this.eventRepository.findByPositionId(positionId, {
      orderBy: 'created_at',
      direction: 'DESC',
      limit: 1
    });

    return events.length > 0 ? events[0] : null;
  }
}