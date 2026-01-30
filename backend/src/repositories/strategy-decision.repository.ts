import type { SupabaseClient } from '@supabase/supabase-js';
import type { 
  StrategyDecisionRecord,
  StrategyDecision,
  DecisionType,
  MarketRegime,
  SetupType
} from '../strategy/strategy.types.js';
import { getSupabaseClient } from '../config/supabase.js';

export class StrategyDecisionRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || getSupabaseClient();
  }

  /**
   * Store strategy decision in database
   */
  async create(decision: StrategyDecision): Promise<StrategyDecisionRecord> {
    try {
      const record: Omit<StrategyDecisionRecord, 'id' | 'createdAt'> = {
        candleId: decision.candleId,
        pair: decision.pair,
        timeframe: decision.timeframe,
        decision: decision.decision,
        regime: decision.regime,
        setupType: decision.setupType,
        confidenceScore: decision.confidenceScore,
        reason: decision.reason,
        tradingWindowStart: decision.tradingWindowStart,
        tradingWindowEnd: decision.tradingWindowEnd,
        candleTimestamp: decision.candleTimestamp
      };

      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .insert(record)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create strategy decision: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Strategy decision creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy decision by ID
   */
  async getById(id: string): Promise<StrategyDecisionRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get strategy decision: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at),
        candleTimestamp: new Date(data.candle_timestamp)
      };

    } catch (error) {
      throw new Error(`Failed to retrieve strategy decision: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy decisions by candle ID
   */
  async getByCandleId(candleId: string): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('candle_id', candleId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get strategy decisions by candle: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy decisions by candle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy decisions by time range
   */
  async getByTimeRange(
    pair: string,
    timeframe: string,
    startTime: Date,
    endTime: Date
  ): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .gte('candle_timestamp', startTime.toISOString())
        .lte('candle_timestamp', endTime.toISOString())
        .order('candle_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Failed to get strategy decisions by time range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy decisions by time range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy decisions by decision type
   */
  async getByDecisionType(
    pair: string,
    timeframe: string,
    decisionType: DecisionType,
    limit: number = 100
  ): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('decision', decisionType)
        .order('candle_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get strategy decisions by type: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy decisions by type: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recent strategy decisions
   */
  async getRecent(
    pair: string,
    timeframe: string,
    limit: number = 50
  ): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .order('candle_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get recent strategy decisions: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve recent strategy decisions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count decisions by type in time range
   */
  async countByType(
    pair: string,
    timeframe: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ [key in DecisionType]: number }> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('decision')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .gte('candle_timestamp', startTime.toISOString())
        .lte('candle_timestamp', endTime.toISOString());

      if (error) {
        throw new Error(`Failed to count decisions by type: ${error.message}`);
      }

      const counts: { [key in DecisionType]: number } = {
        'BUY': 0,
        'SELL': 0,
        'NO_TRADE': 0
      };

      data.forEach(record => {
        counts[record.decision as DecisionType]++;
      });

      return counts;

    } catch (error) {
      throw new Error(`Failed to count decisions by type: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get decisions with high confidence scores
   */
  async getHighConfidenceDecisions(
    pair: string,
    timeframe: string,
    minConfidence: number = 0.8,
    limit: number = 50
  ): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .gte('confidence_score', minConfidence)
        .neq('decision', 'NO_TRADE')
        .order('confidence_score', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get high confidence decisions: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve high confidence decisions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete old strategy decisions (cleanup)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        throw new Error(`Failed to delete old strategy decisions: ${error.message}`);
      }

      return data?.length || 0;

    } catch (error) {
      throw new Error(`Failed to cleanup old strategy decisions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get decision statistics
   */
  async getDecisionStats(
    pair: string,
    timeframe: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalDecisions: number;
    buyDecisions: number;
    sellDecisions: number;
    noTradeDecisions: number;
    averageConfidence: number;
    highConfidenceCount: number;
  }> {
    try {
      const decisions = await this.getByTimeRange(pair, timeframe, startTime, endTime);
      
      const stats = {
        totalDecisions: decisions.length,
        buyDecisions: decisions.filter(d => d.decision === 'BUY').length,
        sellDecisions: decisions.filter(d => d.decision === 'SELL').length,
        noTradeDecisions: decisions.filter(d => d.decision === 'NO_TRADE').length,
        averageConfidence: 0,
        highConfidenceCount: decisions.filter(d => d.confidenceScore >= 0.8).length
      };

      if (decisions.length > 0) {
        const totalConfidence = decisions.reduce((sum, d) => sum + d.confidenceScore, 0);
        stats.averageConfidence = totalConfidence / decisions.length;
      }

      return stats;

    } catch (error) {
      throw new Error(`Failed to calculate decision statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get strategy decisions by date range (for monitoring)
   */
  async getDecisionsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<StrategyDecisionRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('*')
        .gte('candle_timestamp', startDate.toISOString())
        .lte('candle_timestamp', endDate.toISOString())
        .order('candle_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Failed to get strategy decisions by date range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at),
        candleTimestamp: new Date(record.candle_timestamp)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve strategy decisions by date range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if decision exists for candle
   */
  async existsForCandle(candleId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_decisions')
        .select('id')
        .eq('candle_id', candleId)
        .limit(1);

      if (error) {
        throw new Error(`Failed to check decision existence: ${error.message}`);
      }

      return data.length > 0;

    } catch (error) {
      throw new Error(`Failed to check decision existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}