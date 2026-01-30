/**
 * Order Manager Service - Handles order placement, tracking, and lifecycle management
 */

import { OrderManager } from '../interfaces/order-manager.interface';
import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionReport, 
  ExecutionTrade, 
  ExecutionOrder,
  OrderRequest,
  OrderResponse 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export class OrderManagerService implements OrderManager {
  constructor(private brokerAdapter: BrokerAdapter) {}

  /**
   * Place an order for an execution trade
   */
  async placeOrder(trade: ExecutionTrade): Promise<string> {
    try {
      logger.info('Placing order for execution trade', {
        tradeId: trade.id,
        symbol: trade.pair,
        side: trade.side,
        size: trade.positionSize
      });

      // Create order request
      const orderRequest: OrderRequest = {
        symbol: trade.pair,
        side: trade.side,
        size: trade.positionSize,
        price: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        type: 'MARKET' // For now, we'll use market orders
      };

      // Place order with broker
      const orderResponse: OrderResponse = await this.brokerAdapter.placeOrder(orderRequest);

      // Create execution order record
      const executionOrder = await this.createExecutionOrderRecord(trade, orderRequest, orderResponse);

      logger.info('Order placed successfully', {
        tradeId: trade.id,
        orderId: executionOrder.id,
        brokerOrderId: orderResponse.orderId,
        status: orderResponse.status
      });

      return executionOrder.id;

    } catch (error) {
      logger.error('Failed to place order', {
        tradeId: trade.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<void> {
    try {
      logger.info('Cancelling order', { orderId });

      // Get execution order record
      const executionOrder = await this.getExecutionOrder(orderId);
      if (!executionOrder) {
        throw new Error(`Execution order ${orderId} not found`);
      }

      // Cancel with broker if we have a broker order ID
      if (executionOrder.brokerOrderId) {
        await this.brokerAdapter.cancelOrder(executionOrder.brokerOrderId);
      }

      // Update execution order status
      await this.updateExecutionOrderStatus(orderId, 'CANCELLED');

      logger.info('Order cancelled successfully', {
        orderId,
        brokerOrderId: executionOrder.brokerOrderId
      });

    } catch (error) {
      logger.error('Failed to cancel order', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Handle an execution report from the broker
   */
  async handleExecution(execution: ExecutionReport): Promise<void> {
    try {
      logger.info('Handling execution report', {
        orderId: execution.orderId,
        tradeId: execution.tradeId,
        filledPrice: execution.filledPrice,
        filledSize: execution.filledSize
      });

      // Find the execution order by broker order ID
      const executionOrder = await this.getExecutionOrderByBrokerOrderId(execution.orderId);
      if (!executionOrder) {
        logger.warn('Execution order not found for broker order ID', {
          brokerOrderId: execution.orderId
        });
        return;
      }

      // Create execution record
      await this.createExecutionRecord(executionOrder, execution);

      // Update order status to filled
      await this.updateExecutionOrderStatus(executionOrder.id, 'FILLED');

      logger.info('Execution handled successfully', {
        executionOrderId: executionOrder.id,
        brokerOrderId: execution.orderId,
        filledPrice: execution.filledPrice,
        filledSize: execution.filledSize
      });

    } catch (error) {
      logger.error('Failed to handle execution', {
        execution,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process a partial fill for an order
   */
  async processPartialFill(orderId: string, execution: ExecutionReport): Promise<void> {
    try {
      logger.info('Processing partial fill', {
        orderId,
        filledPrice: execution.filledPrice,
        filledSize: execution.filledSize
      });

      // Get execution order
      const executionOrder = await this.getExecutionOrder(orderId);
      if (!executionOrder) {
        throw new Error(`Execution order ${orderId} not found`);
      }

      // Create execution record for partial fill
      await this.createExecutionRecord(executionOrder, execution);

      // Update order status to partially filled
      await this.updateExecutionOrderStatus(orderId, 'PARTIALLY_FILLED');

      // Check if order is now fully filled
      const totalFilled = await this.getTotalFilledSize(orderId);
      if (totalFilled >= executionOrder.requestedSize) {
        await this.updateExecutionOrderStatus(orderId, 'FILLED');
      }

      logger.info('Partial fill processed successfully', {
        orderId,
        filledSize: execution.filledSize,
        totalFilled
      });

    } catch (error) {
      logger.error('Failed to process partial fill', {
        orderId,
        execution,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create execution order record in database
   */
  private async createExecutionOrderRecord(
    trade: ExecutionTrade,
    orderRequest: OrderRequest,
    orderResponse: OrderResponse
  ): Promise<ExecutionOrder> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_orders')
      .insert([{
        execution_trade_id: trade.id,
        broker_order_id: orderResponse.orderId,
        side: orderRequest.side,
        requested_price: orderRequest.price || 0,
        requested_size: orderRequest.size,
        status: orderResponse.status
      }])
      .select()
      .single();

    if (error) {
      logger.error('Failed to create execution order record', {
        tradeId: trade.id,
        error: error.message
      });
      throw new Error(`Failed to create execution order record: ${error.message}`);
    }

    return {
      id: data.id,
      executionTradeId: data.execution_trade_id,
      brokerOrderId: data.broker_order_id,
      side: data.side,
      requestedPrice: data.requested_price,
      requestedSize: data.requested_size,
      status: data.status,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  /**
   * Create execution record in database
   */
  private async createExecutionRecord(
    executionOrder: ExecutionOrder,
    execution: ExecutionReport
  ): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('executions')
      .insert([{
        execution_order_id: executionOrder.id,
        execution_trade_id: executionOrder.executionTradeId,
        filled_price: execution.filledPrice,
        filled_size: execution.filledSize,
        slippage: execution.slippage,
        execution_time: execution.timestamp.toISOString()
      }]);

    if (error) {
      logger.error('Failed to create execution record', {
        executionOrderId: executionOrder.id,
        error: error.message
      });
      throw new Error(`Failed to create execution record: ${error.message}`);
    }
  }

  /**
   * Get execution order by ID
   */
  private async getExecutionOrder(orderId: string): Promise<ExecutionOrder | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null;
      }
      logger.error('Failed to get execution order', {
        orderId,
        error: error.message
      });
      throw new Error(`Failed to get execution order: ${error.message}`);
    }

    return {
      id: data.id,
      executionTradeId: data.execution_trade_id,
      brokerOrderId: data.broker_order_id,
      side: data.side,
      requestedPrice: data.requested_price,
      requestedSize: data.requested_size,
      status: data.status,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  /**
   * Get execution order by broker order ID
   */
  private async getExecutionOrderByBrokerOrderId(brokerOrderId: string): Promise<ExecutionOrder | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_orders')
      .select('*')
      .eq('broker_order_id', brokerOrderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null;
      }
      logger.error('Failed to get execution order by broker order ID', {
        brokerOrderId,
        error: error.message
      });
      throw new Error(`Failed to get execution order by broker order ID: ${error.message}`);
    }

    return {
      id: data.id,
      executionTradeId: data.execution_trade_id,
      brokerOrderId: data.broker_order_id,
      side: data.side,
      requestedPrice: data.requested_price,
      requestedSize: data.requested_size,
      status: data.status,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  /**
   * Update execution order status
   */
  private async updateExecutionOrderStatus(orderId: string, status: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('execution_orders')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) {
      logger.error('Failed to update execution order status', {
        orderId,
        status,
        error: error.message
      });
      throw new Error(`Failed to update execution order status: ${error.message}`);
    }
  }

  /**
   * Get total filled size for an order
   */
  private async getTotalFilledSize(orderId: string): Promise<number> {
    const { data, error } = await supabase
      .from('executions')
      .select('filled_size')
      .eq('execution_order_id', orderId);

    if (error) {
      logger.error('Failed to get total filled size', {
        orderId,
        error: error.message
      });
      throw new Error(`Failed to get total filled size: ${error.message}`);
    }

    return data.reduce((total, execution) => total + execution.filled_size, 0);
  }

  /**
   * Get all orders for a trade
   */
  async getOrdersForTrade(tradeId: string): Promise<ExecutionOrder[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_orders')
      .select('*')
      .eq('execution_trade_id', tradeId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('Failed to get orders for trade', {
        tradeId,
        error: error.message
      });
      throw new Error(`Failed to get orders for trade: ${error.message}`);
    }

    return data.map(row => ({
      id: row.id,
      executionTradeId: row.execution_trade_id,
      brokerOrderId: row.broker_order_id,
      side: row.side,
      requestedPrice: row.requested_price,
      requestedSize: row.requested_size,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Get all executions for an order
   */
  async getExecutionsForOrder(orderId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('executions')
      .select('*')
      .eq('execution_order_id', orderId)
      .order('execution_time', { ascending: true });

    if (error) {
      logger.error('Failed to get executions for order', {
        orderId,
        error: error.message
      });
      throw new Error(`Failed to get executions for order: ${error.message}`);
    }

    return data.map(row => ({
      id: row.id,
      executionOrderId: row.execution_order_id,
      executionTradeId: row.execution_trade_id,
      filledPrice: row.filled_price,
      filledSize: row.filled_size,
      slippage: row.slippage,
      executionTime: new Date(row.execution_time),
      createdAt: new Date(row.created_at)
    }));
  }
}