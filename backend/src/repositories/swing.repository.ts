import { SwingPoint } from '../indicators/indicator.interface.js';
import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';

export interface ISwingRepository {
  insertSwingPoints(points: SwingPoint[]): Promise<void>;
  getLatestSwingPoints(
    pair: string,
    timeframe: string,
    lookback: number
  ): Promise<SwingPoint[]>;
  getSwingPointsByDateRange(
    pair: string,
    timeframe: string,
    lookback: number,
    from: Date,
    to: Date
  ): Promise<SwingPoint[]>;
  deleteSwingPoints(
    pair: string,
    timeframe: string,
    lookback?: number
  ): Promise<void>;
}

export class SwingRepository implements ISwingRepository {
  private readonly logger = getLogger();
  private readonly client = getSupabaseClient();

  /**
   * Insert swing points with upsert behavior for existing timestamps
   */
  async insertSwingPoints(points: SwingPoint[]): Promise<void> {
    if (!points || points.length === 0) {
      return;
    }

    try {
      this.logger.debug('Inserting swing points', { count: points.length });

      // First, get candle IDs for the timestamps
      const dbPoints = await Promise.all(
        points.map(async (point) => {
          // Get candle_id for this timestamp - try exact match first, then fuzzy match
          let { data: candle, error: candleError } = await this.client
            .from('candles')
            .select('id')
            .eq('pair', point.pair)
            .eq('timeframe', point.timeframe)
            .eq('timestamp', point.timestamp.toISOString())
            .single();

          // If exact match fails, try to find candle within a small time window (±1 minute)
          if (candleError || !candle) {
            const startTime = new Date(point.timestamp.getTime() - 60000); // -1 minute
            const endTime = new Date(point.timestamp.getTime() + 60000);   // +1 minute
            
            const { data: fuzzyCandles, error: fuzzyError } = await this.client
              .from('candles')
              .select('id, timestamp')
              .eq('pair', point.pair)
              .eq('timeframe', point.timeframe)
              .gte('timestamp', startTime.toISOString())
              .lte('timestamp', endTime.toISOString())
              .order('timestamp', { ascending: true })
              .limit(1);

            if (fuzzyError || !fuzzyCandles || fuzzyCandles.length === 0) {
              throw new Error(`Candle not found for timestamp ${point.timestamp.toISOString()}`);
            }
            
            candle = fuzzyCandles[0];
          }

          return {
            candle_id: candle.id,
            pair: point.pair,
            timeframe: point.timeframe,
            candle_timestamp: point.timestamp.toISOString(),
            swing_type: point.type.toUpperCase(), // 'HIGH' or 'LOW' as per schema
            price: point.price,
            left_lookback: point.lookback_periods,
            right_lookback: point.lookback_periods, // Assuming same for both
          };
        })
      );

      // Insert without upsert since there's no unique constraint
      const { error } = await this.client.from('swings').insert(dbPoints);

      if (error) {
        throw new Error(`Failed to insert swing points: ${error.message}`);
      }

      this.logger.debug('Swing points inserted successfully', {
        count: points.length,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to insert swing points', {
        error: errorMessage,
        count: points.length,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Swing points insertion failed: ${errorMessage}`);
    }
  }

  /**
   * Get the latest swing points for a specific pair, timeframe, and lookback period
   */
  async getLatestSwingPoints(
    pair: string,
    timeframe: string,
    lookback: number
  ): Promise<SwingPoint[]> {
    try {
      this.logger.debug('Fetching latest swing points', {
        pair,
        timeframe,
        lookback,
      });

      const { data, error } = await this.client
        .from('swings')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('left_lookback', lookback)
        .order('candle_timestamp', { ascending: false })
        .limit(20); // Get last 20 swing points

      if (error) {
        throw new Error(
          `Failed to fetch latest swing points: ${error.message}`
        );
      }

      const swingPoints: SwingPoint[] = (data || []).map(row => ({
        pair: row.pair,
        timeframe: row.timeframe,
        timestamp: new Date(row.candle_timestamp),
        type: row.swing_type.toLowerCase() as 'high' | 'low',
        price: parseFloat(row.price),
        lookback_periods: row.left_lookback,
      }));

      this.logger.debug('Latest swing points fetched successfully', {
        pair,
        timeframe,
        lookback,
        count: swingPoints.length,
      });

      return swingPoints;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch latest swing points', {
        error: errorMessage,
        pair,
        timeframe,
        lookback,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Swing points fetch failed: ${errorMessage}`);
    }
  }

  /**
   * Get swing points within a date range
   */
  async getSwingPointsByDateRange(
    pair: string,
    timeframe: string,
    lookback: number,
    from: Date,
    to: Date
  ): Promise<SwingPoint[]> {
    try {
      this.logger.debug('Fetching swing points by date range', {
        pair,
        timeframe,
        lookback,
        from: from.toISOString(),
        to: to.toISOString(),
      });

      const { data, error } = await this.client
        .from('swings')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('left_lookback', lookback)
        .gte('candle_timestamp', from.toISOString())
        .lte('candle_timestamp', to.toISOString())
        .order('candle_timestamp', { ascending: true });

      if (error) {
        throw new Error(
          `Failed to fetch swing points by date range: ${error.message}`
        );
      }

      const swingPoints: SwingPoint[] = (data || []).map(row => ({
        pair: row.pair,
        timeframe: row.timeframe,
        timestamp: new Date(row.candle_timestamp),
        type: row.swing_type.toLowerCase() as 'high' | 'low',
        price: parseFloat(row.price),
        lookback_periods: row.left_lookback,
      }));

      this.logger.debug('Swing points fetched by date range successfully', {
        pair,
        timeframe,
        lookback,
        count: swingPoints.length,
      });

      return swingPoints;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch swing points by date range', {
        error: errorMessage,
        pair,
        timeframe,
        lookback,
        from: from.toISOString(),
        to: to.toISOString(),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Swing points date range fetch failed: ${errorMessage}`);
    }
  }

  /**
   * Delete swing points for a specific pair and timeframe
   */
  async deleteSwingPoints(
    pair: string,
    timeframe: string,
    lookback?: number
  ): Promise<void> {
    try {
      this.logger.debug('Deleting swing points', { pair, timeframe, lookback });

      let query = this.client
        .from('swings')
        .delete()
        .eq('pair', pair)
        .eq('timeframe', timeframe);

      if (lookback !== undefined) {
        query = query.eq('left_lookback', lookback);
      }

      const { error } = await query;

      if (error) {
        throw new Error(`Failed to delete swing points: ${error.message}`);
      }

      this.logger.debug('Swing points deleted successfully', {
        pair,
        timeframe,
        lookback,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to delete swing points', {
        error: errorMessage,
        pair,
        timeframe,
        lookback,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Swing points deletion failed: ${errorMessage}`);
    }
  }

  /**
   * Get swing points by type (high or low)
   */
  async getSwingPointsByType(
    pair: string,
    timeframe: string,
    lookback: number,
    type: 'high' | 'low',
    limit: number = 10
  ): Promise<SwingPoint[]> {
    try {
      this.logger.debug('Fetching swing points by type', {
        pair,
        timeframe,
        lookback,
        type,
        limit,
      });

      const { data, error } = await this.client
        .from('swings')
        .select('*')
        .eq('pair', pair)
        .eq('timeframe', timeframe)
        .eq('left_lookback', lookback)
        .eq('swing_type', type.toUpperCase())
        .order('candle_timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(
          `Failed to fetch swing points by type: ${error.message}`
        );
      }

      const swingPoints: SwingPoint[] = (data || []).map(row => ({
        pair: row.pair,
        timeframe: row.timeframe,
        timestamp: new Date(row.candle_timestamp),
        type: row.swing_type.toLowerCase() as 'high' | 'low',
        price: parseFloat(row.price),
        lookback_periods: row.left_lookback,
      }));

      this.logger.debug('Swing points fetched by type successfully', {
        pair,
        timeframe,
        lookback,
        type,
        count: swingPoints.length,
      });

      return swingPoints;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to fetch swing points by type', {
        error: errorMessage,
        pair,
        timeframe,
        lookback,
        type,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Swing points type fetch failed: ${errorMessage}`);
    }
  }
}
