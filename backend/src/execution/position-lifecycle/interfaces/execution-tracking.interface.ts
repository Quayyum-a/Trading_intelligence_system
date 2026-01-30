/**
 * Execution Tracking Service Interface - Records and manages trade executions
 */

import { TradeExecution, ExecutionData, FillData } from '../types/position-lifecycle.types';

export interface IExecutionTrackingService {
  /**
   * Record a new execution event
   * @param execution - Execution data to record
   * @returns Promise<TradeExecution> - Created trade execution record
   */
  recordExecution(execution: ExecutionData): Promise<TradeExecution>;

  /**
   * Process a partial fill for a position
   * @param positionId - ID of the position being filled
   * @param fillData - Fill execution data
   * @returns Promise<void>
   */
  processPartialFill(positionId: string, fillData: FillData): Promise<void>;

  /**
   * Process a full fill for a position
   * @param positionId - ID of the position being filled
   * @param fillData - Fill execution data
   * @returns Promise<void>
   */
  processFullFill(positionId: string, fillData: FillData): Promise<void>;

  /**
   * Trigger stop loss execution
   * @param positionId - ID of the position
   * @param marketPrice - Current market price that triggered SL
   * @returns Promise<void>
   */
  triggerStopLoss(positionId: string, marketPrice: number): Promise<void>;

  /**
   * Trigger take profit execution
   * @param positionId - ID of the position
   * @param marketPrice - Current market price that triggered TP
   * @returns Promise<void>
   */
  triggerTakeProfit(positionId: string, marketPrice: number): Promise<void>;
}