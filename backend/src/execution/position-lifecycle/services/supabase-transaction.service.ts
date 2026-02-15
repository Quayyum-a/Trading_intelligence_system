import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Supabase Transaction Service
 * 
 * This service provides atomic database operations using PostgreSQL stored procedures.
 * Each operation is automatically wrapped in a transaction by Supabase, providing
 * true ACID guarantees without client-side transaction control.
 * 
 * Key differences from TransactionCoordinatorService:
 * - Uses stored procedures instead of client-side transaction control
 * - Each RPC call is automatically atomic
 * - No BEGIN/COMMIT/ROLLBACK needed - handled by PostgreSQL
 * - Automatic rollback on any error
 * - Built-in deadlock handling by PostgreSQL
 */
export class SupabaseTransactionService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Atomically close a position
   * 
   * This operation:
   * 1. Locks the position row
   * 2. Validates position state
   * 3. Calculates P&L
   * 4. Updates position status
   * 5. Creates balance event
   * 6. Updates account balance
   * 7. Releases margin
   * 
   * All steps are atomic - either all succeed or all rollback.
   */
  async closePosition(params: {
    positionId: string;
    closePrice: number;
    closeReason: string;
  }): Promise<{
    success: boolean;
    positionId: string;
    pnl: number;
    closePrice: number;
  }> {
    const transactionId = uuidv4();

    const { data, error } = await this.supabase.rpc('atomic_close_position', {
      p_position_id: params.positionId,
      p_close_price: params.closePrice,
      p_close_reason: params.closeReason,
      p_transaction_id: transactionId,
    });

    if (error) {
      throw new Error(`Failed to close position: ${error.message}`);
    }

    return data;
  }

  /**
   * Atomically update stop loss and take profit
   * 
   * This operation:
   * 1. Locks the position row
   * 2. Validates position is open
   * 3. Updates SL/TP levels
   * 
   * All steps are atomic - either all succeed or all rollback.
   */
  async updateStopLossTakeProfit(params: {
    positionId: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<{
    success: boolean;
    positionId: string;
    stopLoss?: number;
    takeProfit?: number;
  }> {
    const transactionId = uuidv4();

    const { data, error } = await this.supabase.rpc('atomic_update_sltp', {
      p_position_id: params.positionId,
      p_transaction_id: transactionId,
      p_stop_loss: params.stopLoss ?? null,
      p_take_profit: params.takeProfit ?? null,
    });

    if (error) {
      throw new Error(`Failed to update SL/TP: ${error.message}`);
    }

    return data;
  }

  /**
   * Atomically open a new position
   * 
   * This operation:
   * 1. Locks the account row
   * 2. Validates margin availability
   * 3. Creates position
   * 4. Reserves margin
   * 5. Creates balance event
   * 
   * All steps are atomic - either all succeed or all rollback.
   */
  async openPosition(params: {
    accountId: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    marginRequired: number;
  }): Promise<{
    success: boolean;
    positionId: string;
  }> {
    const transactionId = uuidv4();

    const { data, error } = await this.supabase.rpc('atomic_open_position', {
      p_account_id: params.accountId,
      p_symbol: params.symbol,
      p_side: params.side,
      p_quantity: params.quantity,
      p_entry_price: params.entryPrice,
      p_margin_required: params.marginRequired,
      p_transaction_id: transactionId,
      p_stop_loss: params.stopLoss ?? null,
      p_take_profit: params.takeProfit ?? null,
    });

    if (error) {
      throw new Error(`Failed to open position: ${error.message}`);
    }

    return data;
  }

  /**
   * Query transaction logs for monitoring and debugging
   */
  async getTransactionLogs(params?: {
    status?: 'STARTED' | 'COMMITTED' | 'ROLLED_BACK' | 'FAILED';
    operationName?: string;
    limit?: number;
  }) {
    let query = this.supabase
      .from('transaction_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (params?.status) {
      query = query.eq('status', params.status);
    }

    if (params?.operationName) {
      query = query.eq('operation_name', params.operationName);
    }

    if (params?.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to query transaction logs: ${error.message}`);
    }

    return data;
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(params?: {
    startDate?: Date;
    endDate?: Date;
  }) {
    const { data, error } = await this.supabase.rpc('get_transaction_stats', {
      p_start_date: params?.startDate?.toISOString() ?? null,
      p_end_date: params?.endDate?.toISOString() ?? null,
    });

    if (error) {
      // If function doesn't exist, return basic stats
      const logs = await this.getTransactionLogs({ limit: 1000 });
      
      const stats = {
        total: logs.length,
        committed: logs.filter(l => l.status === 'COMMITTED').length,
        rolled_back: logs.filter(l => l.status === 'ROLLED_BACK').length,
        failed: logs.filter(l => l.status === 'FAILED').length,
        avg_duration_ms: logs.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / logs.length,
      };

      return stats;
    }

    return data;
  }
}
