import type { SupabaseClient } from '@supabase/supabase-js';
import type { 
  TradeSignalRecord,
  TradeSignal,
  TradeDirection
} from '../strategy/strategy.types.js';
import { getSupabaseClient } from '../config/supabase.js';

export class TradeSignalRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || getSupabaseClient();
  }

  /**
   * Store trade signal in database
   */
  async create(signal: TradeSignal, strategyDecisionId: string, candleTimestamp: Date): Promise<TradeSignalRecord> {
    try {
      const record: Omit<TradeSignalRecord, 'id' | 'createdAt'> = {
        strategyDecisionId,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        rrRatio: signal.rrRatio,
        riskPercent: signal.riskPercent,
        leverage: signal.leverage,
        positionSize: signal.positionSize,
        marginRequired: signal.marginRequired,
        candleTimestamp
      };

      const { data, error } = await this.supabase
        .from('trade_signals')
        .insert(record)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create trade signal: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at),
        candleTimestamp: new Date(data.candle_timestamp)
      };

    } catch (error) {
      throw new Error(`Trade signal creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get trade signal by ID
   */
  async getById(id: string): Promise<TradeSignalRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('trade_signals')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get trade signal: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at),
        candleTimestamp: new Date(data.candle_timestamp)
      };

    } catch (error) {
      throw new Error(`Failed to retrieve trade signal: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get trade signal by strategy decision ID
   */
  async getByStrategyDecisionId(strategyDecisionId: string): Promise<TradeSignalRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('trade_signals')
        .select('*')
        .eq('strategy_decision_id', strategyDecisionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get trade signal by decision: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at),
        candleTimestamp: new Date(data.candle_timestamp)
      };

    } catch (error) {
      throw new Error(`Failed to retrieve trade signal by decision: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get trade signals by time range
   */
  async getByTimeRange(
    startTime: Date,
    endTime: Date,
    direction?: TradeDirection
  ): Promise<TradeSignalRecord[]> {
    try {
      let query = this.supabase
        .from('trade_signals')
        .select('*')
        .gte('candle_timestamp', startTime.toISOString())
        .lte('candle_timestamp', endTime.toISOString());

      if (direction) {
        query = query.eq('direction', direction);
      }

      const { data, error } = await query.order('candle_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Failed to get trade signals by time range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve trade signals by time range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recent trade signals
   */
  async getRecent(limit: number = 50, direction?: TradeDirection): Promise<TradeSignalRecord[]> {
    try {
      let query = this.supabase
        .from('trade_signals')
        .select('*');

      if (direction) {
        query = query.eq('direction', direction);
      }

      const { data, error } = await query
        .order('candle_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get recent trade signals: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve recent trade signals: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get signals with high RR ratios
   */
  async getHighRRSignals(
    minRR: number = 3.0,
    limit: number = 50
  ): Promise<TradeSignalRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('trade_signals')
        .select('*')
        .gte('rr_ratio', minRR)
        .order('rr_ratio', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get high RR signals: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve high RR signals: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count signals by direction in time range
   */
  async countByDirection(
    startTime: Date,
    endTime: Date
  ): Promise<{ BUY: number; SELL: number }> {
    try {
      const { data, error } = await this.supabase
        .from('trade_signals')
        .select('direction')
        .gte('candle_timestamp', startTime.toISOString())
        .lte('candle_timestamp', endTime.toISOString());

      if (error) {
        throw new Error(`Failed to count signals by direction: ${error.message}`);
      }

      const counts = { BUY: 0, SELL: 0 };
      data.forEach(record => {
        counts[record.direction as TradeDirection]++;
      });

      return counts;

    } catch (error) {
      throw new Error(`Failed to count signals by direction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get signal statistics
   */
  async getSignalStats(
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalSignals: number;
    buySignals: number;
    sellSignals: number;
    averageRR: number;
    averagePositionSize: number;
    totalMarginRequired: number;
    averageRiskPercent: number;
  }> {
    try {
      const signals = await this.getByTimeRange(startTime, endTime);
      
      const stats = {
        totalSignals: signals.length,
        buySignals: signals.filter(s => s.direction === 'BUY').length,
        sellSignals: signals.filter(s => s.direction === 'SELL').length,
        averageRR: 0,
        averagePositionSize: 0,
        totalMarginRequired: 0,
        averageRiskPercent: 0
      };

      if (signals.length > 0) {
        stats.averageRR = signals.reduce((sum, s) => sum + s.rrRatio, 0) / signals.length;
        stats.averagePositionSize = signals.reduce((sum, s) => sum + s.positionSize, 0) / signals.length;
        stats.totalMarginRequired = signals.reduce((sum, s) => sum + s.marginRequired, 0);
        stats.averageRiskPercent = signals.reduce((sum, s) => sum + s.riskPercent, 0) / signals.length;
      }

      return stats;

    } catch (error) {
      throw new Error(`Failed to calculate signal statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get signals with position size in range
   */
  async getByPositionSizeRange(
    minSize: number,
    maxSize: number,
    limit: number = 100
  ): Promise<TradeSignalRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('trade_signals')
        .select('*')
        .gte('position_size', minSize)
        .lte('position_size', maxSize)
        .order('candle_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get signals by position size range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve signals by position size range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete old trade signals (cleanup)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('trade_signals')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        throw new Error(`Failed to delete old trade signals: ${error.message}`);
      }

      return data?.length || 0;

    } catch (error) {
      throw new Error(`Failed to cleanup old trade signals: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate signal parameters
   */
  private validateSignal(signal: TradeSignal): string[] {
    const errors: string[] = [];

    if (signal.entryPrice <= 0) {
      errors.push('Entry price must be positive');
    }

    if (signal.stopLoss <= 0) {
      errors.push('Stop loss must be positive');
    }

    if (signal.takeProfit <= 0) {
      errors.push('Take profit must be positive');
    }

    if (signal.rrRatio < 1) {
      errors.push('RR ratio must be at least 1:1');
    }

    if (signal.riskPercent <= 0 || signal.riskPercent > 0.1) {
      errors.push('Risk percent must be between 0 and 10%');
    }

    if (signal.positionSize <= 0) {
      errors.push('Position size must be positive');
    }

    if (signal.marginRequired <= 0) {
      errors.push('Margin required must be positive');
    }

    // Direction-specific validations
    if (signal.direction === 'BUY') {
      if (signal.stopLoss >= signal.entryPrice) {
        errors.push('For BUY signals, stop loss must be below entry price');
      }
      if (signal.takeProfit <= signal.entryPrice) {
        errors.push('For BUY signals, take profit must be above entry price');
      }
    } else if (signal.direction === 'SELL') {
      if (signal.stopLoss <= signal.entryPrice) {
        errors.push('For SELL signals, stop loss must be above entry price');
      }
      if (signal.takeProfit >= signal.entryPrice) {
        errors.push('For SELL signals, take profit must be below entry price');
      }
    }

    return errors;
  }

  /**
   * Create signal with validation
   */
  async createValidated(signal: TradeSignal, strategyDecisionId: string, candleTimestamp: Date): Promise<TradeSignalRecord> {
    const validationErrors = this.validateSignal(signal);
    if (validationErrors.length > 0) {
      throw new Error(`Signal validation failed: ${validationErrors.join(', ')}`);
    }

    return this.create(signal, strategyDecisionId, candleTimestamp);
  }
}