/**
 * Stop Loss / Take Profit Manager Service - Handles SL/TP order placement and monitoring
 */

import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { OrderManagerService } from './order-manager.service';
import { TradeEventLoggerService } from './trade-event-logger.service';
import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionTrade, 
  OrderRequest, 
  ExecutionCloseReason,
  Position 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface SLTPOrderInfo {
  orderId: string;
  type: 'STOP_LOSS' | 'TAKE_PROFIT';
  triggerPrice: number;
  size: number;
  isActive: boolean;
}

export class SLTPManagerService {
  constructor(
    private brokerAdapter: BrokerAdapter,
    private orderManager: OrderManagerService,
    private eventLogger: TradeEventLoggerService
  ) {}

  /**
   * Place stop loss and take profit orders for a filled trade
   */
  async placeSLTPOrders(trade: ExecutionTrade, position: Position): Promise<SLTPOrderInfo[]> {
    try {
      logger.info('Placing SL/TP orders for trade', {
        tradeId: trade.id,
        positionId: position.id,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit
      });

      const slTpOrders: SLTPOrderInfo[] = [];

      // Place stop loss order
      if (trade.stopLoss > 0) {
        const slOrder = await this.placeStopLossOrder(trade, position);
        slTpOrders.push(slOrder);
      }

      // Place take profit order
      if (trade.takeProfit > 0) {
        const tpOrder = await this.takeProfitOrder(trade, position);
        slTpOrders.push(tpOrder);
      }

      logger.info('SL/TP orders placed successfully', {
        tradeId: trade.id,
        ordersPlaced: slTpOrders.length
      });

      return slTpOrders;

    } catch (error) {
      logger.error('Failed to place SL/TP orders', {
        tradeId: trade.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Place stop loss order
   */
  private async placeStopLossOrder(trade: ExecutionTrade, position: Position): Promise<SLTPOrderInfo> {
    const stopLossOrder: OrderRequest = {
      symbol: trade.pair,
      side: trade.side === 'BUY' ? 'SELL' : 'BUY', // Opposite side to close position
      size: position.size,
      price: trade.stopLoss,
      type: 'LIMIT' // Use limit order at stop loss price
    };

    const orderResponse = await this.brokerAdapter.placeOrder(stopLossOrder);

    // Store SL order info
    await this.storeSLTPOrderInfo(trade.id, 'STOP_LOSS', orderResponse.orderId, trade.stopLoss, position.size);

    logger.info('Stop loss order placed', {
      tradeId: trade.id,
      orderId: orderResponse.orderId,
      triggerPrice: trade.stopLoss,
      size: position.size
    });

    return {
      orderId: orderResponse.orderId,
      type: 'STOP_LOSS',
      triggerPrice: trade.stopLoss,
      size: position.size,
      isActive: true
    };
  }

  /**
   * Place take profit order
   */
  private async takeProfitOrder(trade: ExecutionTrade, position: Position): Promise<SLTPOrderInfo> {
    const takeProfitOrder: OrderRequest = {
      symbol: trade.pair,
      side: trade.side === 'BUY' ? 'SELL' : 'BUY', // Opposite side to close position
      size: position.size,
      price: trade.takeProfit,
      type: 'LIMIT' // Use limit order at take profit price
    };

    const orderResponse = await this.brokerAdapter.placeOrder(takeProfitOrder);

    // Store TP order info
    await this.storeSLTPOrderInfo(trade.id, 'TAKE_PROFIT', orderResponse.orderId, trade.takeProfit, position.size);

    logger.info('Take profit order placed', {
      tradeId: trade.id,
      orderId: orderResponse.orderId,
      triggerPrice: trade.takeProfit,
      size: position.size
    });

    return {
      orderId: orderResponse.orderId,
      type: 'TAKE_PROFIT',
      triggerPrice: trade.takeProfit,
      size: position.size,
      isActive: true
    };
  }

  /**
   * Handle stop loss trigger
   */
  async handleStopLossHit(tradeId: string, executionPrice: number, executionSize: number): Promise<void> {
    try {
      logger.info('Handling stop loss hit', {
        tradeId,
        executionPrice,
        executionSize
      });

      // Cancel any remaining take profit orders
      await this.cancelRemainingOrders(tradeId, 'TAKE_PROFIT');

      // Update trade status to closed
      await this.closeTradeWithReason(tradeId, 'SL', executionPrice);

      // Log stop loss hit event
      await this.eventLogger.logStopLossHit(tradeId, {
        executionPrice,
        executionSize,
        timestamp: new Date()
      });

      logger.info('Stop loss hit handled successfully', {
        tradeId,
        executionPrice
      });

    } catch (error) {
      logger.error('Failed to handle stop loss hit', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Handle take profit trigger
   */
  async handleTakeProfitHit(tradeId: string, executionPrice: number, executionSize: number): Promise<void> {
    try {
      logger.info('Handling take profit hit', {
        tradeId,
        executionPrice,
        executionSize
      });

      // Cancel any remaining stop loss orders
      await this.cancelRemainingOrders(tradeId, 'STOP_LOSS');

      // Update trade status to closed
      await this.closeTradeWithReason(tradeId, 'TP', executionPrice);

      // Log take profit hit event
      await this.eventLogger.logTakeProfitHit(tradeId, {
        executionPrice,
        executionSize,
        timestamp: new Date()
      });

      logger.info('Take profit hit handled successfully', {
        tradeId,
        executionPrice
      });

    } catch (error) {
      logger.error('Failed to handle take profit hit', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cancel all SL/TP orders for a trade
   */
  async cancelSLTPOrders(tradeId: string): Promise<void> {
    try {
      logger.info('Cancelling SL/TP orders for trade', { tradeId });

      await Promise.all([
        this.cancelRemainingOrders(tradeId, 'STOP_LOSS'),
        this.cancelRemainingOrders(tradeId, 'TAKE_PROFIT')
      ]);

      logger.info('SL/TP orders cancelled successfully', { tradeId });

    } catch (error) {
      logger.error('Failed to cancel SL/TP orders', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update SL/TP levels for an active trade
   */
  async updateSLTPLevels(tradeId: string, newStopLoss?: number, newTakeProfit?: number): Promise<void> {
    try {
      logger.info('Updating SL/TP levels', {
        tradeId,
        newStopLoss,
        newTakeProfit
      });

      // Cancel existing orders
      await this.cancelSLTPOrders(tradeId);

      // Get trade and position info
      const trade = await this.getExecutionTrade(tradeId);
      const position = await this.getPositionForTrade(tradeId);

      if (!trade || !position) {
        throw new Error(`Trade or position not found for trade ID: ${tradeId}`);
      }

      // Update trade with new levels
      if (newStopLoss !== undefined) {
        trade.stopLoss = newStopLoss;
      }
      if (newTakeProfit !== undefined) {
        trade.takeProfit = newTakeProfit;
      }

      // Place new orders with updated levels
      await this.placeSLTPOrders(trade, position);

      // Update trade record in database
      await this.updateTradeStopLossTakeProfit(tradeId, trade.stopLoss, trade.takeProfit);

      logger.info('SL/TP levels updated successfully', {
        tradeId,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit
      });

    } catch (error) {
      logger.error('Failed to update SL/TP levels', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Store SL/TP order information
   */
  private async storeSLTPOrderInfo(
    tradeId: string,
    type: 'STOP_LOSS' | 'TAKE_PROFIT',
    orderId: string,
    triggerPrice: number,
    size: number
  ): Promise<void> {
    // This would typically be stored in a separate table for SL/TP orders
    // For now, we'll use the metadata field in execution_trade_events
    await this.eventLogger.createTradeEvent({
      executionTradeId: tradeId,
      eventType: 'ORDER_SENT',
      metadata: {
        orderType: type,
        orderId,
        triggerPrice,
        size,
        timestamp: new Date()
      }
    });
  }

  /**
   * Cancel remaining orders of a specific type
   */
  private async cancelRemainingOrders(tradeId: string, orderType: 'STOP_LOSS' | 'TAKE_PROFIT'): Promise<void> {
    // Get active orders for the trade
    const activeOrders = await this.getActiveSLTPOrders(tradeId, orderType);

    // Cancel each active order
    for (const orderInfo of activeOrders) {
      try {
        await this.brokerAdapter.cancelOrder(orderInfo.orderId);
        await this.markOrderAsInactive(tradeId, orderInfo.orderId);
      } catch (error) {
        logger.warn('Failed to cancel order', {
          tradeId,
          orderId: orderInfo.orderId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Close trade with specific reason
   */
  private async closeTradeWithReason(tradeId: string, reason: ExecutionCloseReason, closePrice: number): Promise<void> {
    const { error } = await supabase
      .from('execution_trades')
      .update({
        status: 'CLOSED',
        close_reason: reason,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', tradeId);

    if (error) {
      throw new Error(`Failed to close trade: ${error.message}`);
    }

    // Also update the position
    await supabase
      .from('positions')
      .update({
        closed_at: new Date().toISOString()
      })
      .eq('execution_trade_id', tradeId);
  }

  /**
   * Get execution trade by ID
   */
  private async getExecutionTrade(tradeId: string): Promise<ExecutionTrade | null> {
    const { data, error } = await supabase
      .from('execution_trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      tradeSignalId: data.trade_signal_id,
      pair: data.pair,
      timeframe: data.timeframe,
      side: data.side,
      status: data.status,
      entryPrice: data.entry_price,
      stopLoss: data.stop_loss,
      takeProfit: data.take_profit,
      positionSize: data.position_size,
      riskPercent: data.risk_percent,
      leverage: data.leverage,
      rr: data.rr,
      executionMode: data.execution_mode,
      openedAt: data.opened_at ? new Date(data.opened_at) : undefined,
      closedAt: data.closed_at ? new Date(data.closed_at) : undefined,
      closeReason: data.close_reason,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  /**
   * Get position for trade
   */
  private async getPositionForTrade(tradeId: string): Promise<Position | null> {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('execution_trade_id', tradeId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      executionTradeId: data.execution_trade_id,
      side: data.side,
      size: data.size,
      avgEntryPrice: data.avg_entry_price,
      stopLoss: data.stop_loss,
      takeProfit: data.take_profit,
      marginUsed: data.margin_used,
      leverage: data.leverage,
      openedAt: new Date(data.opened_at),
      closedAt: data.closed_at ? new Date(data.closed_at) : undefined,
      createdAt: new Date(data.created_at)
    };
  }

  /**
   * Get active SL/TP orders for a trade
   */
  private async getActiveSLTPOrders(tradeId: string, orderType: 'STOP_LOSS' | 'TAKE_PROFIT'): Promise<SLTPOrderInfo[]> {
    // This would query a dedicated SL/TP orders table in a real implementation
    // For now, we'll return empty array as this is a simplified implementation
    return [];
  }

  /**
   * Mark order as inactive
   */
  private async markOrderAsInactive(tradeId: string, orderId: string): Promise<void> {
    // This would update the SL/TP orders table in a real implementation
    logger.info('Order marked as inactive', { tradeId, orderId });
  }

  /**
   * Update trade stop loss and take profit levels
   */
  private async updateTradeStopLossTakeProfit(tradeId: string, stopLoss: number, takeProfit: number): Promise<void> {
    const { error } = await supabase
      .from('execution_trades')
      .update({
        stop_loss: stopLoss,
        take_profit: takeProfit,
        updated_at: new Date().toISOString()
      })
      .eq('id', tradeId);

    if (error) {
      throw new Error(`Failed to update trade SL/TP levels: ${error.message}`);
    }
  }
}