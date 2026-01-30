/**
 * PnL Calculation Service Interface - Handles profit and loss calculations
 */

import { Position } from './position-state-machine.interface';
import { TradeExecution, PositionMetrics } from '../types/position-lifecycle.types';

export interface IPnLCalculationService {
  /**
   * Calculate unrealized PnL for a position at current market price
   * @param position - Position to calculate PnL for
   * @param currentPrice - Current market price
   * @returns number - Unrealized PnL amount
   */
  calculateUnrealizedPnL(position: Position, currentPrice: number): number;

  /**
   * Calculate realized PnL from a trade execution
   * @param execution - Trade execution to calculate PnL for
   * @returns number - Realized PnL amount
   */
  calculateRealizedPnL(execution: TradeExecution): number;

  /**
   * Update position PnL with current market price
   * @param positionId - ID of the position to update
   * @param marketPrice - Current market price
   * @returns Promise<void>
   */
  updatePositionPnL(positionId: string, marketPrice: number): Promise<void>;

  /**
   * Get comprehensive position metrics
   * @param positionId - ID of the position
   * @returns Promise<PositionMetrics> - Position performance metrics
   */
  getPositionMetrics(positionId: string): Promise<PositionMetrics>;
}