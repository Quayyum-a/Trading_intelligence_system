/**
 * Order Manager Interface - Handles order placement, tracking, and lifecycle management
 */

import { ExecutionReport, ExecutionTrade } from '../types/execution.types';

export interface OrderManager {
  /**
   * Place an order for an execution trade
   * @param trade - Execution trade to place order for
   * @returns Promise<string> - Order ID
   */
  placeOrder(trade: ExecutionTrade): Promise<string>;

  /**
   * Cancel an existing order
   * @param orderId - ID of the order to cancel
   * @returns Promise<void>
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Handle an execution report from the broker
   * @param execution - Execution report to process
   * @returns Promise<void>
   */
  handleExecution(execution: ExecutionReport): Promise<void>;

  /**
   * Process a partial fill for an order
   * @param orderId - ID of the order that was partially filled
   * @param execution - Execution report for the partial fill
   * @returns Promise<void>
   */
  processPartialFill(orderId: string, execution: ExecutionReport): Promise<void>;
}