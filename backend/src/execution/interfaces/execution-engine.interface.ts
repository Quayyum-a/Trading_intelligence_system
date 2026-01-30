/**
 * Core Execution Engine Interface
 */

import { ExecutionResult, ExecutionTradeStatus, Position } from '../types/execution.types';

export interface ExecutionEngine {
  /**
   * Process a strategy signal and execute the trade
   * @param signalId - ID of the trade signal to process
   * @returns Promise<ExecutionResult> - Result of the execution attempt
   */
  processSignal(signalId: string): Promise<ExecutionResult>;

  /**
   * Get the current execution status of a trade
   * @param tradeId - ID of the execution trade
   * @returns Promise<ExecutionTradeStatus> - Current status of the trade
   */
  getExecutionStatus(tradeId: string): Promise<ExecutionTradeStatus>;

  /**
   * Cancel an active trade
   * @param tradeId - ID of the execution trade to cancel
   * @returns Promise<void>
   */
  cancelTrade(tradeId: string): Promise<void>;

  /**
   * Get all active positions
   * @returns Promise<Position[]> - Array of active positions
   */
  getActivePositions(): Promise<Position[]>;
}