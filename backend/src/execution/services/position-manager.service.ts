/**
 * Position Manager Service - Tracks and manages open positions, including PnL calculations
 */

import { PositionManager } from '../interfaces/position-manager.interface';
import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionCloseReason, 
  ExecutionReport, 
  ExecutionTrade, 
  Position 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export class PositionManagerService implements PositionManager {
  /**
   * Open a new position from a filled trade
   */
  async openPosition(trade: ExecutionTrade, execution: ExecutionReport): Promise<string> {
    try {
      logger.info('Opening position for filled trade', {
        tradeId: trade.id,
        symbol: trade.pair,
        side: trade.side,
        size: execution.filledSize,
        entryPrice: execution.filledPrice
      });

      // Calculate margin used
      const marginUsed = this.calculateMarginUsed(
        execution.filledSize,
        execution.filledPrice,
        trade.leverage
      );

      // Create position record
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('positions')
        .insert([{
          execution_trade_id: trade.id,
          side: trade.side,
          size: execution.filledSize,
          avg_entry_price: execution.filledPrice,
          stop_loss: trade.stopLoss,
          take_profit: trade.takeProfit,
          margin_used: marginUsed,
          leverage: trade.leverage,
          opened_at: execution.timestamp.toISOString()
        }])
        .select()
        .single();

      if (error) {
        logger.error('Failed to create position record', {
          tradeId: trade.id,
          error: error.message
        });
        throw new Error(`Failed to create position record: ${error.message}`);
      }

      logger.info('Position opened successfully', {
        positionId: data.id,
        tradeId: trade.id,
        size: execution.filledSize,
        entryPrice: execution.filledPrice,
        marginUsed
      });

      return data.id;

    } catch (error) {
      logger.error('Failed to open position', {
        tradeId: trade.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update a position with current market price
   */
  async updatePosition(positionId: string, marketPrice: number): Promise<void> {
    try {
      // Get current position
      const position = await this.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      // Calculate unrealized PnL
      const unrealizedPnL = this.calculateUnrealizedPnLInternal(position, marketPrice);

      // Update position with current price (this would typically be stored in a separate table)
      logger.info('Position updated with market price', {
        positionId,
        marketPrice,
        unrealizedPnL
      });

      // In a real implementation, we might store current price and unrealized PnL
      // For now, we'll just log the update

    } catch (error) {
      logger.error('Failed to update position', {
        positionId,
        marketPrice,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Close a position
   */
  async closePosition(positionId: string, reason: ExecutionCloseReason): Promise<void> {
    try {
      logger.info('Closing position', {
        positionId,
        reason
      });

      // Update position record
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('positions')
        .update({
          closed_at: new Date().toISOString()
        })
        .eq('id', positionId);

      if (error) {
        logger.error('Failed to close position', {
          positionId,
          error: error.message
        });
        throw new Error(`Failed to close position: ${error.message}`);
      }

      // Update the corresponding execution trade
      await this.updateTradeStatus(positionId, reason);

      logger.info('Position closed successfully', {
        positionId,
        reason
      });

    } catch (error) {
      logger.error('Failed to close position', {
        positionId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate unrealized PnL for a position
   */
  async calculateUnrealizedPnL(positionId: string): Promise<number> {
    try {
      const position = await this.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      // For this implementation, we'll use the entry price as current price
      // In a real implementation, this would use live market data
      const currentPrice = position.avgEntryPrice; // This should be replaced with actual market price
      
      return this.calculateUnrealizedPnLInternal(position, currentPrice);

    } catch (error) {
      logger.error('Failed to calculate unrealized PnL', {
        positionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all open positions
   */
  async getOpenPositions(): Promise<Position[]> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .is('closed_at', null)
        .order('opened_at', { ascending: false });

      if (error) {
        logger.error('Failed to get open positions', {
          error: error.message
        });
        throw new Error(`Failed to get open positions: ${error.message}`);
      }

      return data.map(row => this.mapRowToPosition(row));

    } catch (error) {
      logger.error('Failed to get open positions', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get position by ID
   */
  async getPosition(positionId: string): Promise<Position | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('id', positionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null;
        }
        logger.error('Failed to get position', {
          positionId,
          error: error.message
        });
        throw new Error(`Failed to get position: ${error.message}`);
      }

      return this.mapRowToPosition(data);

    } catch (error) {
      logger.error('Failed to get position', {
        positionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get position by trade ID
   */
  async getPositionByTradeId(tradeId: string): Promise<Position | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('execution_trade_id', tradeId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null;
        }
        logger.error('Failed to get position by trade ID', {
          tradeId,
          error: error.message
        });
        throw new Error(`Failed to get position by trade ID: ${error.message}`);
      }

      return this.mapRowToPosition(data);

    } catch (error) {
      logger.error('Failed to get position by trade ID', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate realized PnL for a closed position
   */
  async calculateRealizedPnL(positionId: string, closePrice: number): Promise<number> {
    try {
      const position = await this.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      const realizedPnL = this.calculateRealizedPnLInternal(position, closePrice);

      logger.info('Realized PnL calculated', {
        positionId,
        entryPrice: position.avgEntryPrice,
        closePrice,
        size: position.size,
        side: position.side,
        realizedPnL
      });

      return realizedPnL;

    } catch (error) {
      logger.error('Failed to calculate realized PnL', {
        positionId,
        closePrice,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get position statistics
   */
  async getPositionStats(): Promise<{
    totalOpen: number;
    totalMarginUsed: number;
    totalUnrealizedPnL: number;
  }> {
    try {
      const openPositions = await this.getOpenPositions();
      
      const totalOpen = openPositions.length;
      const totalMarginUsed = openPositions.reduce((sum, pos) => sum + pos.marginUsed, 0);
      
      // Calculate total unrealized PnL (using entry price as current price for now)
      const totalUnrealizedPnL = openPositions.reduce((sum, pos) => {
        const unrealizedPnL = this.calculateUnrealizedPnLInternal(pos, pos.avgEntryPrice);
        return sum + unrealizedPnL;
      }, 0);

      return {
        totalOpen,
        totalMarginUsed,
        totalUnrealizedPnL
      };

    } catch (error) {
      logger.error('Failed to get position stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate margin used for a position
   */
  private calculateMarginUsed(size: number, price: number, leverage: number): number {
    return (size * price) / leverage;
  }

  /**
   * Calculate unrealized PnL internally
   */
  private calculateUnrealizedPnLInternal(position: Position, currentPrice: number): number {
    const priceDifference = position.side === 'BUY' 
      ? currentPrice - position.avgEntryPrice
      : position.avgEntryPrice - currentPrice;
    
    return priceDifference * position.size;
  }

  /**
   * Calculate realized PnL internally
   */
  private calculateRealizedPnLInternal(position: Position, closePrice: number): number {
    const priceDifference = position.side === 'BUY'
      ? closePrice - position.avgEntryPrice
      : position.avgEntryPrice - closePrice;
    
    return priceDifference * position.size;
  }

  /**
   * Update trade status when position is closed
   */
  private async updateTradeStatus(positionId: string, reason: ExecutionCloseReason): Promise<void> {
    // Get the trade ID from the position
    const position = await this.getPosition(positionId);
    if (!position) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('execution_trades')
      .update({
        status: 'CLOSED',
        close_reason: reason,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', position.executionTradeId);

    if (error) {
      logger.error('Failed to update trade status', {
        tradeId: position.executionTradeId,
        error: error.message
      });
    }
  }

  /**
   * Map database row to Position object
   */
  private mapRowToPosition(row: any): Position {
    return {
      id: row.id,
      executionTradeId: row.execution_trade_id,
      side: row.side,
      size: row.size,
      avgEntryPrice: row.avg_entry_price,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      marginUsed: row.margin_used,
      leverage: row.leverage,
      openedAt: new Date(row.opened_at),
      closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Update position stop loss and take profit levels
   */
  async updatePositionSLTP(positionId: string, stopLoss?: number, takeProfit?: number): Promise<void> {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (stopLoss !== undefined) {
        updateData.stop_loss = stopLoss;
      }
      if (takeProfit !== undefined) {
        updateData.take_profit = takeProfit;
      }

      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('positions')
        .update(updateData)
        .eq('id', positionId);

      if (error) {
        throw new Error(`Failed to update position SL/TP: ${error.message}`);
      }

      logger.info('Position SL/TP updated', {
        positionId,
        stopLoss,
        takeProfit
      });

    } catch (error) {
      logger.error('Failed to update position SL/TP', {
        positionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}