/**
 * Execution Tracking Service Interface - Records and manages trade executions
 * Enhanced with improved partial fill tracking capabilities
 */

import { TradeExecution, ExecutionData, FillData } from '../types/position-lifecycle.types';
import { IPartialFillTracker } from '../services/partial-fill-tracker.service';

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
   * @param isEntry - Whether this is an entry fill (default: true)
   * @returns Promise<void>
   */
  processPartialFill(positionId: string, fillData: FillData, isEntry?: boolean): Promise<void>;

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

  /**
   * Get the partial fill tracker instance
   * @returns IPartialFillTracker
   */
  getPartialFillTracker(): IPartialFillTracker;

  /**
   * Get fill aggregation for an order
   * @param orderId - Order ID to get aggregation for
   * @returns Promise with fill aggregation data
   */
  getOrderFillAggregation(orderId: string): Promise<any>;

  /**
   * Get remaining quantity for an order
   * @param orderId - Order ID to check
   * @returns Promise<number> - Remaining quantity
   */
  getRemainingOrderQuantity(orderId: string): Promise<number>;

  /**
   * Check if an order is completely filled
   * @param orderId - Order ID to check
   * @returns Promise<boolean> - True if order is complete
   */
  isOrderCompletelyFilled(orderId: string): Promise<boolean>;

  /**
   * Validate fill consistency for an order
   * @param orderId - Order ID to validate
   * @returns Promise with validation result
   */
  validateOrderFillConsistency(orderId: string): Promise<{
    isConsistent: boolean;
    issues: string[];
  }>;
}