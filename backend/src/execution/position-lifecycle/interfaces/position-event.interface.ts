/**
 * Position Event Service Interface - Handles event sourcing and audit trails
 */

import { PositionEvent, PositionEventType } from '../types/position-lifecycle.types';
import { Position } from './position-state-machine.interface';

export interface IPositionEventService {
  /**
   * Emit a position event for audit trail
   * @param positionId - ID of the position
   * @param eventType - Type of event being emitted
   * @param payload - Event payload data
   * @returns Promise<void>
   */
  emitEvent(positionId: string, eventType: PositionEventType, payload: any): Promise<void>;

  /**
   * Replay events to rebuild position state
   * @param positionId - ID of the position to replay
   * @returns Promise<Position> - Rebuilt position state
   */
  replayEvents(positionId: string): Promise<Position>;

  /**
   * Validate a sequence of events for consistency
   * @param events - Array of position events to validate
   * @returns boolean - True if event sequence is valid
   */
  validateEventSequence(events: PositionEvent[]): boolean;

  /**
   * Get complete event history for a position
   * @param positionId - ID of the position
   * @returns Promise<PositionEvent[]> - Array of position events
   */
  getEventHistory(positionId: string): Promise<PositionEvent[]>;
}