/**
 * Broker Adapter Interface - All broker implementations must conform to this interface
 */

import { 
  AccountInfo, 
  BrokerPosition, 
  ExecutionReport, 
  OrderRequest, 
  OrderResponse, 
  OrderStatus 
} from '../types/execution.types';

export interface BrokerAdapter {
  /**
   * Connect to the broker
   * @returns Promise<void>
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the broker
   * @returns Promise<void>
   */
  disconnect(): Promise<void>;

  /**
   * Validate account and get account information
   * @returns Promise<AccountInfo> - Account details
   */
  validateAccount(): Promise<AccountInfo>;

  /**
   * Place an order with the broker
   * @param order - Order request details
   * @returns Promise<OrderResponse> - Order response from broker
   */
  placeOrder(order: OrderRequest): Promise<OrderResponse>;

  /**
   * Cancel an existing order
   * @param orderId - ID of the order to cancel
   * @returns Promise<void>
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Get the status of an order
   * @param orderId - ID of the order to check
   * @returns Promise<OrderStatus> - Current order status
   */
  getOrderStatus(orderId: string): Promise<OrderStatus>;

  /**
   * Get all open positions
   * @returns Promise<BrokerPosition[]> - Array of open positions
   */
  getOpenPositions(): Promise<BrokerPosition[]>;

  /**
   * Close a specific position
   * @param positionId - ID of the position to close
   * @returns Promise<void>
   */
  closePosition(positionId: string): Promise<void>;

  /**
   * Subscribe to execution reports
   * @param callback - Callback function to handle execution reports
   * @returns void
   */
  subscribeToExecutions(callback: (execution: ExecutionReport) => void): void;
}