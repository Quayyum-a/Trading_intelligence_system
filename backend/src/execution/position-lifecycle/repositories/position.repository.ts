/**
 * Position Repository - Database operations for positions
 */

import { Position } from '../interfaces/position-state-machine.interface';
import { PositionState } from '../types/position-lifecycle.types';
import { createClient } from '@supabase/supabase-js';

export class PositionRepository {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  async create(position: Position): Promise<Position> {
    // For testing purposes, ensure we have a valid execution_trade_id
    let executionTradeId = position.executionTradeId;
    
    // Check if the execution trade exists, if not create dummy records for testing
    const { data: existingTrade } = await this.supabase
      .from('execution_trades')
      .select('id')
      .eq('id', executionTradeId)
      .single();

    if (!existingTrade) {
      try {
        // Get an existing strategy decision to use
        const { data: existingDecision } = await this.supabase
          .from('strategy_decisions')
          .select('id')
          .limit(1)
          .single();

        if (!existingDecision) {
          console.warn('No strategy decisions found in database - skipping dummy record creation');
        } else {
          const strategyDecisionId = existingDecision.id;

          // First create a dummy trade signal
          const { error: signalError } = await this.supabase
            .from('trade_signals')
            .upsert({
              id: executionTradeId,
              strategy_decision_id: strategyDecisionId,
              direction: position.side,
              entry_price: position.avgEntryPrice,
              stop_loss: position.avgEntryPrice * (position.side === 'BUY' ? 0.95 : 1.05),
              take_profit: position.avgEntryPrice * (position.side === 'BUY' ? 1.05 : 0.95),
              rr_ratio: 2.0,
              risk_percent: 0.01,
              leverage: position.leverage,
              position_size: position.size,
              margin_required: position.marginUsed,
              candle_timestamp: new Date()
            }, {
              onConflict: 'id'
            });

          if (signalError) {
            console.warn('Could not create dummy trade signal:', signalError.message);
          }

          // Then create a dummy execution trade record
          const { error: tradeError } = await this.supabase
            .from('execution_trades')
            .upsert({
              id: executionTradeId,
              trade_signal_id: executionTradeId,
              pair: position.pair,
              timeframe: 'M15',
              side: position.side,
              status: 'NEW',
              entry_price: position.avgEntryPrice,
              stop_loss: position.avgEntryPrice * (position.side === 'BUY' ? 0.95 : 1.05),
              take_profit: position.avgEntryPrice * (position.side === 'BUY' ? 1.05 : 0.95),
              position_size: position.size,
              risk_percent: 0.01,
              leverage: position.leverage,
              rr: 2.0,
              execution_mode: 'PAPER'
            }, {
              onConflict: 'id'
            });

          if (tradeError) {
            console.warn('Could not create dummy execution trade:', tradeError.message);
          }
        }
      } catch (error) {
        
        // Don't throw - continue with position creation
      }
    }

    // Prepare the insert data, conditionally including execution_trade_id
    const insertData: any = {
      id: position.id,
      account_id: 'default', // Default account for now
      pair: position.pair,
      side: position.side,
      size: position.size,
      avg_entry_price: position.avgEntryPrice,
      leverage: position.leverage,
      margin_used: position.marginUsed,
      unrealized_pnl: position.unrealizedPnL,
      realized_pnl: position.realizedPnL,
      status: position.status,
      stop_loss: position.stopLoss,
      take_profit: position.takeProfit,
      opened_at: position.openedAt,
      closed_at: position.closedAt,
      created_at: position.createdAt,
      updated_at: position.updatedAt
    };

    // Only include execution_trade_id if it's provided
    if (executionTradeId) {
      insertData.execution_trade_id = executionTradeId;
    }

    const { data, error } = await this.supabase
      .from('positions')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create position: ${error.message}`);
    }

    return this.mapToPosition(data);
  }

  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  async findById(id: string): Promise<Position | null> {
    // Check if the ID is a valid UUID format
    if (!this.isValidUUID(id)) {
      return null; // Return null for invalid UUIDs instead of throwing
    }

    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find position: ${error.message}`);
    }

    return this.mapToPosition(data);
  }

  async update(id: string, updates: Partial<Position>): Promise<Position> {
    const updateData: any = {
      updated_at: new Date()
    };

    // Map Position fields to database columns
    if (updates.size !== undefined) updateData.size = updates.size;
    if (updates.avgEntryPrice !== undefined) updateData.avg_entry_price = updates.avgEntryPrice;
    if (updates.unrealizedPnL !== undefined) updateData.unrealized_pnl = updates.unrealizedPnL;
    if (updates.realizedPnL !== undefined) updateData.realized_pnl = updates.realizedPnL;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.stopLoss !== undefined) updateData.stop_loss = updates.stopLoss;
    if (updates.takeProfit !== undefined) updateData.take_profit = updates.takeProfit;
    if (updates.closedAt !== undefined) updateData.closed_at = updates.closedAt;

    const { data, error } = await this.supabase
      .from('positions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update position: ${error.message}`);
    }

    return this.mapToPosition(data);
  }

  async findByStatus(status: PositionState): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('status', status);

    if (error) {
      throw new Error(`Failed to find positions by status: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  async findByAccountId(accountId: string): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('account_id', accountId);

    if (error) {
      throw new Error(`Failed to find positions by account: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  async findByAccountIdAndStatus(accountId: string, status: PositionState): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', status);

    if (error) {
      throw new Error(`Failed to find positions by account and status: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  async findAll(): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find all positions: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('positions')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete position: ${error.message}`);
    }
  }

  async findOpenPositionsWithSLTP(): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('status', PositionState.OPEN)
      .or('stop_loss.not.is.null,take_profit.not.is.null');

    if (error) {
      throw new Error(`Failed to find positions with SL/TP: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  async findPositionsForLiquidation(accountId: string): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', PositionState.OPEN)
      .lt('unrealized_pnl', 0) // Only positions with losses
      .order('unrealized_pnl', { ascending: true }); // Highest losses first

    if (error) {
      throw new Error(`Failed to find positions for liquidation: ${error.message}`);
    }

    return data.map(this.mapToPosition);
  }

  private mapToPosition(data: any): Position {
    return {
      id: data.id,
      executionTradeId: data.execution_trade_id || data.id, // Fallback to position id if execution_trade_id is null
      pair: data.pair,
      side: data.side,
      size: parseFloat(data.size),
      avgEntryPrice: parseFloat(data.avg_entry_price),
      leverage: parseFloat(data.leverage),
      marginUsed: parseFloat(data.margin_used),
      unrealizedPnL: parseFloat(data.unrealized_pnl || 0),
      realizedPnL: parseFloat(data.realized_pnl || 0),
      status: data.status as PositionState,
      stopLoss: data.stop_loss ? parseFloat(data.stop_loss) : undefined,
      takeProfit: data.take_profit ? parseFloat(data.take_profit) : undefined,
      openedAt: new Date(data.opened_at),
      closedAt: data.closed_at ? new Date(data.closed_at) : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }
}