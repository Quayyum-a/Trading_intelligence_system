import { ATRValue } from '../indicators/indicator.interface.js';
import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';

export interface IATRRepository {
  insertATRValues(values: ATRValue[]): Promise<void>;
  getLatestATRValue(pair: string, timeframe: string, period: number): Promise<ATRValue | null>;
  getATRValuesByDateRange(
    pair: string, 
    timeframe: string, 
    period: number, 
    from: Date, 
    to: Date
  ): Promise<ATRValue[]>;
  deleteATRValues(pair: string, timeframe: string, period?: number): Promise<void>;
}

export class ATRRepository implements IATRRepository {
  private readonly logger = getLogger();
  private readonly client = getSupabaseClient();

  /**
   * Insert ATR values with upsert behavior for existing timestamps
   */
  async insertATRValues(values: ATRValue[]): Promise<void> {
    if (!values || values.length === 0) {
      return;
    }

    try {
      this.logger.debug('Inserting ATR values', { count: values.length });

      // First, get candle IDs for the timestamps
      const dbValues = await Promise.all(
        values.map(async (value) => {
          // Get candle_id for this timestamp - try exact match first, then fuzzy match
          let { data: candle, error: candleError } = await this.client
            .from('candles')
            .select('id')
            .eq('pair', value.pair)
            .eq('timeframe', value.timeframe)
            .eq('timestamp', value.timestamp.toISOString())
            .single();

          // If exact match fails, try to find candle within a small time window (±1 minute)
          if (candleError || !candle) {
            const startTime = new Date(value.timestamp.getTime() - 60000); // -1 minute
            const endTime = new Date(value.timestamp.getTime() + 60000);   // +1 minute
            
            const { data: fuzzyCandles, error: fuzzyError } = await this.client
              .from('candles')
              .select('id, timestamp')
              .eq('pair', value.pair)
              .eq('timeframe', value.timeframe)
              .gte('timestamp', startTime.toISOString())
              .lte('timestamp', endTime.toISOString())
              .order('timestamp', { ascending: true })
              .limit(1);

            if (fuzzyError || !fuzzyCandles || fuzzyCandles.length === 0) {
              throw new Error(`Candle not found for timestamp ${value.timestamp.toISOString()}`);
            }
            
            candle = fuzzyCandles[0];
          }

          return {
            candle_id: candle.id,
            pair: value.pair,
            timeframe: value.timeframe,
            period: value.period,
            value: value.value,
            candle_timestamp: value.timestamp.toISOString(),
          };
        })
      );

      // Use upsert to handle existing records based on the unique constraint (candle_id, period)
      const { error } = await this.client.from('atr_values').upsert(dbValues, {
        onConflict: 'candle_id,period',
        ignoreDuplicates: false,
      });

      if (error) {
        throw new Error(`Failed to insert ATR values: ${error.message}`);
      }

      this.logger.debug('ATR values inserted successfully', {
        count: values.length,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to insert ATR values', {
        error: errorMessage,
        count: values.length,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`ATR insertion failed: ${errorMessage}`);
    }
  }

  /**
   * Get the latest ATR value for a specific pair, timeframe, and period
   */
  async getLatestATRValue(pair: string, timeframe: string, period: number): Promise<ATRValue | null> {
    try {
      this.logger.debug('Fetching latest ATR value', { pair, timeframe, period });

      const { data, error } = await this.client
        .from('atr_values')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('period', period)
        .order('candle_timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          this.logger.debug('No ATR value found', { pair, timeframe, period });
          return null;
        }
        throw new Error(`Failed to fetch latest ATR value: ${error.message}`);
      }

      // Check if data is null or undefined
      if (!data) {
        this.logger.debug('No ATR data returned', { pair, timeframe, period });
        return null;
      }

      const atrValue: ATRValue = {
        pair: data.pair,
        timeframe: data.timeframe,
        timestamp: new Date(data.candle_timestamp),
        period: data.period,
        value: parseFloat(data.value)
      };

      this.logger.debug('Latest ATR value fetched successfully', { 
        pair, 
        timeframe, 
        period, 
        timestamp: atrValue.timestamp,
        value: atrValue.value 
      });

      return atrValue;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch latest ATR value', {
        error: errorMessage,
        pair,
        timeframe,
        period,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`ATR fetch failed: ${errorMessage}`);
    }
  }

  /**
   * Get ATR values within a date range
   */
  async getATRValuesByDateRange(
    pair: string, 
    timeframe: string, 
    period: number, 
    from: Date, 
    to: Date
  ): Promise<ATRValue[]> {
    try {
      this.logger.debug('Fetching ATR values by date range', { 
        pair, 
        timeframe, 
        period, 
        from: from.toISOString(), 
        to: to.toISOString() 
      });

      const { data, error } = await this.client
        .from('atr_values')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('period', period)
        .gte('candle_timestamp', from.toISOString())
        .lte('candle_timestamp', to.toISOString())
        .order('candle_timestamp', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch ATR values by date range: ${error.message}`);
      }

      const atrValues: ATRValue[] = (data || []).map(row => ({
        pair: row.pair,
        timeframe: row.timeframe,
        timestamp: new Date(row.candle_timestamp),
        period: row.period,
        value: parseFloat(row.value)
      }));

      this.logger.debug('ATR values fetched by date range successfully', { 
        pair, 
        timeframe, 
        period, 
        count: atrValues.length 
      });

      return atrValues;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch ATR values by date range', {
        error: errorMessage,
        pair,
        timeframe,
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`ATR date range fetch failed: ${errorMessage}`);
    }
  }

  /**
   * Delete ATR values for a specific pair and timeframe
   */
  async deleteATRValues(pair: string, timeframe: string, period?: number): Promise<void> {
    try {
      this.logger.debug('Deleting ATR values', { pair, timeframe, period });

      let query = this.client
        .from('atr_values')
        .delete()
        .eq('pair', pair)
        .eq('timeframe', timeframe);

      if (period !== undefined) {
        query = query.eq('period', period);
      }

      const { error } = await query;

      if (error) {
        throw new Error(`Failed to delete ATR values: ${error.message}`);
      }

      this.logger.debug('ATR values deleted successfully', { pair, timeframe, period });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to delete ATR values', {
        error: errorMessage,
        pair,
        timeframe,
        period,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`ATR deletion failed: ${errorMessage}`);
    }
  }
}