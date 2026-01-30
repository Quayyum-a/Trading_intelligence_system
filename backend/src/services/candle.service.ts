import { CandleRepository } from '../repositories/candle.repository.js';
import type { ICandleRepository } from '../repositories/interfaces.js';
import type { Candle } from '../types/database.js';
import { getLogger } from '../config/logger.js';

export class CandleService {
  private candleRepository: ICandleRepository;
  private logger = getLogger();

  constructor(candleRepository?: ICandleRepository) {
    this.candleRepository = candleRepository || new CandleRepository();
  }

  async addCandle(
    candleData: Omit<Candle, 'id' | 'created_at'>
  ): Promise<void> {
    try {
      this.logger.info('Adding new candle', {
        pair: candleData.pair,
        timeframe: candleData.timeframe,
        timestamp: candleData.timestamp.toISOString(),
      });

      await this.candleRepository.insertCandle(candleData);

      this.logger.info('Candle added successfully', {
        pair: candleData.pair,
        timeframe: candleData.timeframe,
      });
    } catch (error) {
      this.logger.error('Failed to add candle', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair: candleData.pair,
        timeframe: candleData.timeframe,
      });
      throw error;
    }
  }

  async getRecentCandles(
    pair: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candle[]> {
    try {
      this.logger.info('Retrieving recent candles', {
        pair,
        timeframe,
        limit,
      });

      const candles = await this.candleRepository.getCandlesByPairAndTimeframe(
        pair,
        timeframe,
        limit
      );

      this.logger.info('Recent candles retrieved successfully', {
        pair,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      this.logger.error('Failed to retrieve recent candles', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair,
        timeframe,
      });
      throw error;
    }
  }

  async getLatestCandle(
    pair: string,
    timeframe: string
  ): Promise<Candle | null> {
    try {
      const candles = await this.getRecentCandles(pair, timeframe, 1);
      return candles.length > 0 ? candles[0]! : null;
    } catch (error) {
      this.logger.error('Failed to retrieve latest candle', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair,
        timeframe,
      });
      throw error;
    }
  }

  async validateCandleData(
    candle: Omit<Candle, 'id' | 'created_at'>
  ): Promise<boolean> {
    try {
      // Business logic validation (no direct database calls)
      if (!candle.pair || candle.pair.trim().length === 0) {
        throw new Error('Pair is required');
      }

      if (!candle.timeframe || candle.timeframe.trim().length === 0) {
        throw new Error('Timeframe is required');
      }

      if (candle.high < candle.low) {
        throw new Error('High price cannot be less than low price');
      }

      if (candle.high < Math.max(candle.open, candle.close)) {
        throw new Error(
          'High price must be greater than or equal to open and close prices'
        );
      }

      if (candle.low > Math.min(candle.open, candle.close)) {
        throw new Error(
          'Low price must be less than or equal to open and close prices'
        );
      }

      if (candle.volume < 0) {
        throw new Error('Volume cannot be negative');
      }

      return true;
    } catch (error) {
      this.logger.error('Candle validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair: candle.pair,
        timeframe: candle.timeframe,
      });
      throw error;
    }
  }
}
