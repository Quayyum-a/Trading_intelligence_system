/**
 * Position State Machine Interface - Manages formal position state transitions
 */

import { PositionState, PositionEvent, StateTransitionResult } from '../types/position-lifecycle.types';
import { TradeSignal } from '../../types/execution.types';

export interface IPositionStateMachine {
  /**
   * Create a new position from a trade signal
   * @param tradeSignal - Trade signal from strategy engine
   * @returns Promise<Position> - Created position in PENDING state
   */
  createPosition(tradeSignal: TradeSignal): Promise<Position>;

  /**
   * Transition position state based on an event
   * @param positionId - ID of the position to transition
   * @param event - Position event triggering the transition
   * @returns Promise<StateTransitionResult> - Result of the transition
   */
  transitionState(positionId: string, event: PositionEvent): Promise<StateTransitionResult>;

  /**
   * Validate if a state transition is allowed
   * @param currentState - Current position state
   * @param targetState - Target position state
   * @returns boolean - True if transition is valid
   */
  validateTransition(currentState: PositionState, targetState: PositionState): boolean;

  /**
   * Get all valid transitions from a given state
   * @param currentState - Current position state
   * @returns PositionState[] - Array of valid target states
   */
  getValidTransitions(currentState: PositionState): PositionState[];
}

export interface Position {
  id: string;
  executionTradeId: string;
  accountId?: string;
  pair: string;
  side: 'BUY' | 'SELL';
  size: number;
  avgEntryPrice: number;
  leverage: number;
  marginUsed: number;
  unrealizedPnL: number;
  realizedPnL: number;
  status: PositionState;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}