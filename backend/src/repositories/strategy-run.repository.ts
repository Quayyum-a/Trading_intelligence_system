import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyRunRecord } from '../strategy/strategy.types.js';
import { getSupabaseClient } from '../config/supabase.js';

export class StrategyRunRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || getSupabaseClient();
  }

  /**
   * Create a new strategy run record
   */
  async create(
    pair: string,
    timeframe: string,
    runType: 'HISTORICAL' | 'INCREMENTAL'
  ): Promise<StrategyRunRecord> {
    try {
      const record: Omit<StrategyRunRecord, 'id' | 'createdAt' | 'completedAt'> = {
        pair,
        timeframe,
        runType,
        candlesProcessed: 0,
        tradesGenerated: 0,
        startedAt: new Date()
      };

      const { data, error } = await this.supabase
        .from('strategy_runs')
        .insert(record)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create strategy run: ${error.message}`);
      }

      return {
        ...data,
        startedAt: new Date(data.started_at),
        completedAt: new Date(data.completed_at),
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Strategy run creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update strategy run progress
   */
  async updateProgress(
    id: string,
    candlesProcessed: number,
    tradesGenerated: number
  ): Promise<StrategyRunRecord> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .update({
          candles_processed: candlesProcessed,
          trades_generated: tradesGenerated
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update strategy run progress: ${error.message}`);
      }

      return {
        ...data,
        startedAt: new Date(data.started_at),
        completedAt: new Date(data.completed_at),
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Strategy run progress update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Complete a strategy run
   */
  async complete(
    id: string,
    candlesProcessed: number,
    tradesGenerated: number
  ): Promise<StrategyRunRecord> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .update({
          candles_processed: candlesProcessed,
          trades_generated: tradesGenerated,
          completed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to complete strategy run: ${error.message}`);
      }

      return {
        ...data,
        startedAt: new Date(data.started_at),
        completedAt: new Date(data.completed_at),
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Strategy run completion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy run by ID
   */
  async getById(id: string): Promise<StrategyRunRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get strategy run: ${error.message}`);
      }

      return {
        ...data,
        startedAt: new Date(data.started_at),
        completedAt: new Date(data.completed_at),
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Failed to retrieve strategy run: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recent strategy runs
   */
  async getRecent(
    pair?: string,
    timeframe?: string,
    limit: number = 50
  ): Promise<StrategyRunRecord[]> {
    try {
      let query = this.supabase
        .from('strategy_runs')
        .select('*');

      if (pair) {
        query = query.eq('pair', pair);
      }

      if (timeframe) {
        query = query.eq('timeframe', timeframe);
      }

      const { data, error } = await query
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get recent strategy runs: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        startedAt: new Date(record.started_at),
        completedAt: new Date(record.completed_at),
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve recent strategy runs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy runs by time range
   */
  async getByTimeRange(
    startTime: Date,
    endTime: Date,
    pair?: string,
    timeframe?: string
  ): Promise<StrategyRunRecord[]> {
    try {
      let query = this.supabase
        .from('strategy_runs')
        .select('*')
        .gte('started_at', startTime.toISOString())
        .lte('started_at', endTime.toISOString());

      if (pair) {
        query = query.eq('pair', pair);
      }

      if (timeframe) {
        query = query.eq('timeframe', timeframe);
      }

      const { data, error } = await query.order('started_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to get strategy runs by time range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        startedAt: new Date(record.started_at),
        completedAt: new Date(record.completed_at),
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy runs by time range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy runs by type
   */
  async getByType(
    runType: 'HISTORICAL' | 'INCREMENTAL',
    limit: number = 100
  ): Promise<StrategyRunRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .select('*')
        .eq('run_type', runType)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get strategy runs by type: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        startedAt: new Date(record.started_at),
        completedAt: new Date(record.completed_at),
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy runs by type: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get active (incomplete) strategy runs
   */
  async getActive(): Promise<StrategyRunRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .select('*')
        .is('completed_at', null)
        .order('started_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get active strategy runs: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        startedAt: new Date(record.started_at),
        completedAt: record.completed_at ? new Date(record.completed_at) : new Date(),
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve active strategy runs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy run statistics
   */
  async getRunStats(
    startTime: Date,
    endTime: Date,
    pair?: string,
    timeframe?: string
  ): Promise<{
    totalRuns: number;
    completedRuns: number;
    activeRuns: number;
    historicalRuns: number;
    incrementalRuns: number;
    totalCandlesProcessed: number;
    totalTradesGenerated: number;
    averageCandlesPerRun: number;
    averageTradesPerRun: number;
    averageRunDuration: number; // in minutes
  }> {
    try {
      const runs = await this.getByTimeRange(startTime, endTime, pair, timeframe);
      
      const stats = {
        totalRuns: runs.length,
        completedRuns: runs.filter(run => run.completedAt).length,
        activeRuns: runs.filter(run => !run.completedAt).length,
        historicalRuns: runs.filter(run => run.runType === 'HISTORICAL').length,
        incrementalRuns: runs.filter(run => run.runType === 'INCREMENTAL').length,
        totalCandlesProcessed: runs.reduce((sum, run) => sum + run.candlesProcessed, 0),
        totalTradesGenerated: runs.reduce((sum, run) => sum + run.tradesGenerated, 0),
        averageCandlesPerRun: 0,
        averageTradesPerRun: 0,
        averageRunDuration: 0
      };

      if (runs.length > 0) {
        stats.averageCandlesPerRun = stats.totalCandlesProcessed / runs.length;
        stats.averageTradesPerRun = stats.totalTradesGenerated / runs.length;
        
        // Calculate average duration for completed runs
        const completedRuns = runs.filter(run => run.completedAt);
        if (completedRuns.length > 0) {
          const totalDuration = completedRuns.reduce((sum, run) => {
            const duration = run.completedAt.getTime() - run.startedAt.getTime();
            return sum + duration;
          }, 0);
          stats.averageRunDuration = totalDuration / completedRuns.length / (1000 * 60); // Convert to minutes
        }
      }

      return stats;

    } catch (error) {
      throw new Error(`Failed to calculate run statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get performance metrics for strategy runs
   */
  async getPerformanceMetrics(
    pair: string,
    timeframe: string,
    limit: number = 10
  ): Promise<{
    recentRuns: Array<{
      id: string;
      runType: string;
      candlesProcessed: number;
      tradesGenerated: number;
      duration: number; // in minutes
      tradesPerCandle: number;
      startedAt: Date;
      completedAt: Date | null;
    }>;
    averageMetrics: {
      candlesPerRun: number;
      tradesPerRun: number;
      tradesPerCandle: number;
      runDuration: number;
    };
  }> {
    try {
      const runs = await this.getRecent(pair, timeframe, limit);
      const completedRuns = runs.filter(run => run.completedAt);
      
      const recentRuns = runs.map(run => ({
        id: run.id,
        runType: run.runType,
        candlesProcessed: run.candlesProcessed,
        tradesGenerated: run.tradesGenerated,
        duration: run.completedAt ? 
          (run.completedAt.getTime() - run.startedAt.getTime()) / (1000 * 60) : 0,
        tradesPerCandle: run.candlesProcessed > 0 ? run.tradesGenerated / run.candlesProcessed : 0,
        startedAt: run.startedAt,
        completedAt: run.completedAt
      }));

      const averageMetrics = {
        candlesPerRun: 0,
        tradesPerRun: 0,
        tradesPerCandle: 0,
        runDuration: 0
      };

      if (completedRuns.length > 0) {
        averageMetrics.candlesPerRun = completedRuns.reduce((sum, run) => sum + run.candlesProcessed, 0) / completedRuns.length;
        averageMetrics.tradesPerRun = completedRuns.reduce((sum, run) => sum + run.tradesGenerated, 0) / completedRuns.length;
        
        const totalCandles = completedRuns.reduce((sum, run) => sum + run.candlesProcessed, 0);
        const totalTrades = completedRuns.reduce((sum, run) => sum + run.tradesGenerated, 0);
        averageMetrics.tradesPerCandle = totalCandles > 0 ? totalTrades / totalCandles : 0;
        
        const totalDuration = completedRuns.reduce((sum, run) => {
          return sum + (run.completedAt!.getTime() - run.startedAt.getTime());
        }, 0);
        averageMetrics.runDuration = totalDuration / completedRuns.length / (1000 * 60);
      }

      return {
        recentRuns,
        averageMetrics
      };

    } catch (error) {
      throw new Error(`Failed to get performance metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete old strategy runs (cleanup)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('strategy_runs')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        throw new Error(`Failed to delete old strategy runs: ${error.message}`);
      }

      return data?.length || 0;

    } catch (error) {
      throw new Error(`Failed to cleanup old strategy runs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Mark run as failed (for error handling)
   */
  async markAsFailed(id: string, errorMessage: string): Promise<StrategyRunRecord> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_runs')
        .update({
          completed_at: new Date().toISOString(),
          // Note: We might want to add an error_message field to the schema
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to mark strategy run as failed: ${error.message}`);
      }

      return {
        ...data,
        startedAt: new Date(data.started_at),
        completedAt: new Date(data.completed_at),
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Failed to mark run as failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}