/**
 * Base Broker Adapter - Abstract base class for all broker implementations
 */

import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { 
  AccountInfo, 
  BrokerPosition, 
  ExecutionReport, 
  OrderRequest, 
  OrderResponse, 
  OrderStatus 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export abstract class BaseBrokerAdapter implements BrokerAdapter {
  protected isConnected: boolean = false;
  protected accountInfo: AccountInfo | null = null;
  protected executionCallbacks: ((execution: ExecutionReport) => void)[] = [];

  /**
   * Connect to the broker - must be implemented by subclasses
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the broker - must be implemented by subclasses
   */
  abstract disconnect(): Promise<void>;

  /**
   * Validate account and get account information - must be implemented by subclasses
   */
  abstract validateAccount(): Promise<AccountInfo>;

  /**
   * Place an order with the broker - must be implemented by subclasses
   */
  abstract placeOrder(order: OrderRequest): Promise<OrderResponse>;

  /**
   * Cancel an existing order - must be implemented by subclasses
   */
  abstract cancelOrder(orderId: string): Promise<void>;

  /**
   * Get the status of an order - must be implemented by subclasses
   */
  abstract getOrderStatus(orderId: string): Promise<OrderStatus>;

  /**
   * Get all open positions - must be implemented by subclasses
   */
  abstract getOpenPositions(): Promise<BrokerPosition[]>;

  /**
   * Close a specific position - must be implemented by subclasses
   */
  abstract closePosition(positionId: string): Promise<void>;

  /**
   * Subscribe to execution reports
   */
  subscribeToExecutions(callback: (execution: ExecutionReport) => void): void {
    this.executionCallbacks.push(callback);
    logger.info('Execution callback subscribed', {
      callbackCount: this.executionCallbacks.length
    });
  }

  /**
   * Unsubscribe from execution reports
   */
  unsubscribeFromExecutions(callback: (execution: ExecutionReport) => void): void {
    const index = this.executionCallbacks.indexOf(callback);
    if (index > -1) {
      this.executionCallbacks.splice(index, 1);
      logger.info('Execution callback unsubscribed', {
        callbackCount: this.executionCallbacks.length
      });
    }
  }

  /**
   * Notify all subscribers of an execution report
   */
  protected notifyExecutionCallbacks(execution: ExecutionReport): void {
    this.executionCallbacks.forEach(callback => {
      try {
        callback(execution);
      } catch (error) {
        logger.error('Error in execution callback', {
          execution,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  /**
   * Check if the adapter is connected
   */
  isAdapterConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get cached account information
   */
  getCachedAccountInfo(): AccountInfo | null {
    return this.accountInfo;
  }

  /**
   * Validate order request parameters
   */
  protected validateOrderRequest(order: OrderRequest): void {
    if (!order.symbol || order.symbol.trim().length === 0) {
      throw new Error('Order symbol is required');
    }

    if (!['BUY', 'SELL'].includes(order.side)) {
      throw new Error('Order side must be BUY or SELL');
    }

    if (order.size <= 0) {
      throw new Error('Order size must be positive');
    }

    if (order.price !== undefined && order.price <= 0) {
      throw new Error('Order price must be positive');
    }

    if (order.stopLoss !== undefined && order.stopLoss <= 0) {
      throw new Error('Stop loss must be positive');
    }

    if (order.takeProfit !== undefined && order.takeProfit <= 0) {
      throw new Error('Take profit must be positive');
    }

    if (!['MARKET', 'LIMIT'].includes(order.type)) {
      throw new Error('Order type must be MARKET or LIMIT');
    }

    // For LIMIT orders, price is required
    if (order.type === 'LIMIT' && order.price === undefined) {
      throw new Error('Price is required for LIMIT orders');
    }
  }

  /**
   * Generate a unique order ID
   */
  protected generateOrderId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate slippage between requested and filled price
   */
  protected calculateSlippage(requestedPrice: number, filledPrice: number): number {
    if (requestedPrice === 0) return 0;
    return Math.abs(filledPrice - requestedPrice) / requestedPrice;
  }

  /**
   * Validate connection before operations
   */
  protected ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error('Broker adapter is not connected');
    }
  }

  /**
   * Log broker operation
   */
  protected logOperation(operation: string, params: any, result?: any): void {
    logger.info(`Broker operation: ${operation}`, {
      operation,
      params,
      result,
      adapterType: this.constructor.name
    });
  }

  /**
   * Log broker error
   */
  protected logError(operation: string, params: any, error: any): void {
    logger.error(`Broker operation failed: ${operation}`, {
      operation,
      params,
      error: error instanceof Error ? error.message : error,
      adapterType: this.constructor.name
    });
  }

  /**
   * Get adapter type name
   */
  getAdapterType(): string {
    return this.constructor.name;
  }

  /**
   * Health check for the adapter
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      // Try to get account info as a health check
      await this.validateAccount();
      return true;
    } catch (error) {
      logger.error('Broker adapter health check failed', {
        adapterType: this.getAdapterType(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}