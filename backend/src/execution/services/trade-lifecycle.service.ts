/**
 * Trade Lifecycle Service - Manages execution trade state machine and transitions
 */

import { ExecutionTradeStatus, ExecutionEventType } from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface StateTransitionResult {
  success: boolean;
  newStatus?: ExecutionTradeStatus;
  error?: string;
  eventType?: ExecutionEventType;
}

export class TradeLifecycleService {
  // Define valid state transitions
  private readonly VALID_TRANSITIONS: Record<ExecutionTradeStatus, ExecutionTradeStatus[]> = {
    'NEW': ['VALIDATED'],
    'VALIDATED': ['ORDER_PLACED'],
    'ORDER_PLACED': ['PARTIALLY_FILLED', 'FILLED'],
    'PARTIALLY_FILLED': ['FILLED'],
    'FILLED': ['OPEN'],
    'OPEN': ['CLOSED'],
    'CLOSED': []
  };

  // Map status transitions to event types
  private readonly STATUS_TO_EVENT: Record<string, ExecutionEventType> = {
    'NEW->VALIDATED': 'VALIDATED',
    'VALIDATED->ORDER_PLACED': 'ORDER_SENT',
    'ORDER_PLACED->PARTIALLY_FILLED': 'PARTIAL_FILL',
    'ORDER_PLACED->FILLED': 'FILLED',
    'PARTIALLY_FILLED->FILLED': 'FILLED',
    'FILLED->OPEN': 'OPENED',
    'OPEN->CLOSED': 'CLOSED'
  };

  /**
   * Validate if a state transition is allowed
   */
  isValidTransition(fromStatus: ExecutionTradeStatus, toStatus: ExecutionTradeStatus): boolean {
    const allowedTransitions = this.VALID_TRANSITIONS[fromStatus];
    return allowedTransitions ? allowedTransitions.includes(toStatus) : false;
  }

  /**
   * Attempt to transition a trade to a new status
   */
  transitionTo(
    tradeId: string,
    currentStatus: ExecutionTradeStatus,
    newStatus: ExecutionTradeStatus,
    metadata?: Record<string, any>
  ): StateTransitionResult {
    try {
      // Validate the transition
      if (!this.isValidTransition(currentStatus, newStatus)) {
        const error = `Invalid state transition from ${currentStatus} to ${newStatus}`;
        logger.error('Invalid state transition attempted', {
          tradeId,
          fromStatus: currentStatus,
          toStatus: newStatus,
          error
        });

        return {
          success: false,
          error
        };
      }

      // Get the corresponding event type
      const transitionKey = `${currentStatus}->${newStatus}`;
      const eventType = this.STATUS_TO_EVENT[transitionKey];

      if (!eventType) {
        const error = `No event type mapped for transition ${transitionKey}`;
        logger.error('Missing event type mapping', {
          tradeId,
          transitionKey,
          error
        });

        return {
          success: false,
          error
        };
      }

      logger.info('Trade state transition successful', {
        tradeId,
        fromStatus: currentStatus,
        toStatus: newStatus,
        eventType,
        metadata
      });

      return {
        success: true,
        newStatus,
        eventType
      };

    } catch (error) {
      const errorMessage = `Error during state transition: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error('State transition error', {
        tradeId,
        fromStatus: currentStatus,
        toStatus: newStatus,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get all valid next states for a given status
   */
  getValidNextStates(currentStatus: ExecutionTradeStatus): ExecutionTradeStatus[] {
    return this.VALID_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Check if a status is a terminal state (no further transitions possible)
   */
  isTerminalState(status: ExecutionTradeStatus): boolean {
    const nextStates = this.getValidNextStates(status);
    return nextStates.length === 0;
  }

  /**
   * Get the initial state for new trades
   */
  getInitialState(): ExecutionTradeStatus {
    return 'NEW';
  }

  /**
   * Validate a sequence of state transitions
   */
  validateTransitionSequence(transitions: ExecutionTradeStatus[]): boolean {
    if (transitions.length < 2) {
      return true; // Single state or empty sequence is valid
    }

    for (let i = 0; i < transitions.length - 1; i++) {
      const currentState = transitions[i];
      const nextState = transitions[i + 1];
      
      if (!this.isValidTransition(currentState, nextState)) {
        logger.warn('Invalid transition in sequence', {
          sequence: transitions,
          invalidTransition: `${currentState} -> ${nextState}`,
          position: i
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Get event type for a specific transition
   */
  getEventTypeForTransition(fromStatus: ExecutionTradeStatus, toStatus: ExecutionTradeStatus): ExecutionEventType | null {
    const transitionKey = `${fromStatus}->${toStatus}`;
    return this.STATUS_TO_EVENT[transitionKey] || null;
  }

  /**
   * Check if a trade can be cancelled from its current state
   */
  canBeCancelled(currentStatus: ExecutionTradeStatus): boolean {
    // Trades can typically be cancelled before they are filled
    return ['NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED'].includes(currentStatus);
  }

  /**
   * Check if a trade is in an active state (can be executed)
   */
  isActiveState(status: ExecutionTradeStatus): boolean {
    return ['VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN'].includes(status);
  }

  /**
   * Check if a trade is completed (in final state)
   */
  isCompletedState(status: ExecutionTradeStatus): boolean {
    return status === 'CLOSED';
  }

  /**
   * Get all possible states in the state machine
   */
  getAllStates(): ExecutionTradeStatus[] {
    return ['NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN', 'CLOSED'];
  }

  /**
   * Validate that a status is a valid ExecutionTradeStatus
   */
  isValidStatus(status: string): status is ExecutionTradeStatus {
    return this.getAllStates().includes(status as ExecutionTradeStatus);
  }
}