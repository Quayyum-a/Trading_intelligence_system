import type { BrokerCandle } from '../brokers/broker.interface.js';
import { logger } from '../config/logger.js';

/**
 * Candle Normalization Service
 *
 * Converts broker-specific candlestick data into a standardized format
 * with UTC timestamps, consistent precision, and validated OHLC relationships.
 */

export interface NormalizedCandle {
  pair: string;
  timeframe: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizationConfig {
  priceDecimalPlaces: number;
  volumeDecimalPlaces: number;
  useAskPrices?: boolean; // for brokers with bid/ask separation
}

export class NormalizationError extends Error {
  constructor(
    message: string,
    public originalData?: any
  ) {
    super(message);
    this.name = 'NormalizationError';
  }
}

export class CandleNormalizer {
  private config: NormalizationConfig;

  constructor(
    config: NormalizationConfig = {
      priceDecimalPlaces: 5,
      volumeDecimalPlaces: 0,
      useAskPrices: false,
    }
  ) {
    this.config = config;
  }

  /**
   * Normalizes a single broker candle to standard format
   */
  normalize(
    brokerCandle: BrokerCandle,
    pair: string,
    timeframe: string,
    brokerName: string
  ): NormalizedCandle {
    try {
      // Convert timestamp to UTC Date object
      const timestamp = this.normalizeTimestamp(brokerCandle.timestamp);

      // Round prices to consistent decimal places
      const open = this.roundPrice(brokerCandle.open);
      const high = this.roundPrice(brokerCandle.high);
      const low = this.roundPrice(brokerCandle.low);
      const close = this.roundPrice(brokerCandle.close);

      // Round volume
      const volume = this.roundVolume(brokerCandle.volume || 0);

      // Validate OHLC integrity
      this.validateOHLCIntegrity(open, high, low, close);

      const normalizedCandle: NormalizedCandle = {
        pair,
        timeframe,
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      };

      logger.debug('Candle normalized successfully', {
        broker: brokerName,
        pair,
        timeframe,
        timestamp: timestamp.toISOString(),
        ohlc: { open, high, low, close },
        volume,
      });

      return normalizedCandle;
    } catch (error) {
      logger.error('Failed to normalize candle', {
        broker: brokerName,
        pair,
        timeframe,
        originalCandle: brokerCandle,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof NormalizationError) {
        throw error;
      }

      throw new NormalizationError(
        `Failed to normalize candle: ${error instanceof Error ? error.message : 'Unknown error'}`,
        brokerCandle
      );
    }
  }

  /**
   * Normalizes multiple broker candles
   */
  normalizeMany(
    brokerCandles: BrokerCandle[],
    pair: string,
    timeframe: string,
    brokerName: string
  ): NormalizedCandle[] {
    const normalizedCandles: NormalizedCandle[] = [];
    const errors: string[] = [];

    for (let i = 0; i < brokerCandles.length; i++) {
      try {
        const normalized = this.normalize(
          brokerCandles[i],
          pair,
          timeframe,
          brokerName
        );
        normalizedCandles.push(normalized);
      } catch (error) {
        const errorMessage = `Candle ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMessage);
        logger.warn('Skipping invalid candle during batch normalization', {
          broker: brokerName,
          pair,
          timeframe,
          candleIndex: i,
          error: errorMessage,
        });
      }
    }

    if (errors.length > 0) {
      logger.warn('Some candles failed normalization', {
        broker: brokerName,
        pair,
        timeframe,
        totalCandles: brokerCandles.length,
        successfulCandles: normalizedCandles.length,
        failedCandles: errors.length,
        errors: errors.slice(0, 5), // Log first 5 errors
      });
    }

    return normalizedCandles;
  }

  /**
   * Converts timestamp string to UTC Date object
   */
  private normalizeTimestamp(timestamp: string): Date {
    if (!timestamp) {
      throw new NormalizationError('Timestamp is required');
    }

    let date: Date;

    try {
      // Try parsing as ISO string first
      date = new Date(timestamp);

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        // Try parsing as Unix timestamp (seconds)
        const unixTimestamp = parseInt(timestamp, 10);
        if (!isNaN(unixTimestamp)) {
          date = new Date(unixTimestamp * 1000);
        } else {
          throw new Error('Invalid timestamp format');
        }
      }

      // Ensure the date is reasonable (not too far in past or future)
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1);
      const oneYearFromNow = new Date(now.getFullYear() + 1, 11, 31);

      if (date < tenYearsAgo || date > oneYearFromNow) {
        throw new Error('Timestamp is outside reasonable range');
      }

      return date;
    } catch (error) {
      throw new NormalizationError(
        `Invalid timestamp format: ${timestamp}. Expected ISO string or Unix timestamp.`
      );
    }
  }

  /**
   * Rounds price to configured decimal places
   */
  private roundPrice(price: number): number {
    if (typeof price !== 'number' || isNaN(price) || !isFinite(price)) {
      throw new NormalizationError(`Invalid price value: ${price}`);
    }

    if (price <= 0) {
      throw new NormalizationError(`Price must be positive: ${price}`);
    }

    const multiplier = Math.pow(10, this.config.priceDecimalPlaces);
    return Math.round(price * multiplier) / multiplier;
  }

  /**
   * Rounds volume to configured decimal places
   */
  private roundVolume(volume: number): number {
    if (typeof volume !== 'number' || isNaN(volume) || !isFinite(volume)) {
      throw new NormalizationError(`Invalid volume value: ${volume}`);
    }

    if (volume < 0) {
      throw new NormalizationError(`Volume cannot be negative: ${volume}`);
    }

    const multiplier = Math.pow(10, this.config.volumeDecimalPlaces);
    return Math.round(volume * multiplier) / multiplier;
  }

  /**
   * Validates OHLC integrity relationships
   */
  private validateOHLCIntegrity(
    open: number,
    high: number,
    low: number,
    close: number
  ): void {
    // High should be >= Open and Close
    if (high < open) {
      throw new NormalizationError(
        `OHLC integrity violation: High (${high}) < Open (${open})`
      );
    }

    if (high < close) {
      throw new NormalizationError(
        `OHLC integrity violation: High (${high}) < Close (${close})`
      );
    }

    // Low should be <= Open and Close
    if (low > open) {
      throw new NormalizationError(
        `OHLC integrity violation: Low (${low}) > Open (${open})`
      );
    }

    if (low > close) {
      throw new NormalizationError(
        `OHLC integrity violation: Low (${low}) > Close (${close})`
      );
    }

    // High should be >= Low
    if (high < low) {
      throw new NormalizationError(
        `OHLC integrity violation: High (${high}) < Low (${low})`
      );
    }
  }

  /**
   * Updates normalization configuration
   */
  updateConfig(newConfig: Partial<NormalizationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.info('Candle normalizer configuration updated', {
      config: this.config,
    });
  }

  /**
   * Gets current normalization configuration
   */
  getConfig(): NormalizationConfig {
    return { ...this.config };
  }
}
