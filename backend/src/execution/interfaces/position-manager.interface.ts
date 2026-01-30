/**
 * Position Manager Interface - Tracks and manages open positions, including PnL calculations
 */

import { ExecutionCloseReason, ExecutionReport, ExecutionTrade } from '../types/execution.types';

export interface PositionManager {
  /**
   * Open a new position from a filled trade
   * @param trade - Execution trade that was filled
   * @param execution - Execution report with fill details
   * @returns Promise<string> - Position ID
   */
  openPosition(trade: ExecutionTrade, execution: ExecutionReport): Promise<string>;

  /**
   * Update a position with current market price
   * @param positionId - ID of the position to update
   * @param marketPrice - Current market price
   * @returns Promise<void>
   */
  updatePosition(positionId: string, marketPrice: number): Promise<void>;

  /**
   * Close a position
   * @param positionId - ID of the position to close
   * @param reason - Reason for closing the position
   * @returns Promise<void>
   */
  closePosition(positionId: string, reason: ExecutionCloseReason): Promise<void>;

  /**
   * Calculate unrealized PnL for a position
   * @param positionId - ID of the position
   * @returns Promise<number> - Unrealized PnL amount
   */
  calculateUnrealizedPnL(positionId: string): Promise<number>;
}