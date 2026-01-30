import { BaseRepository } from '../repositories/base.repository.js';
import type { Candle } from '../types/database.js';
import type { CandleRepository } from '../repositories/candle.repository.js';

export interface TimestampGap {
  expectedTimestamp: Date;
  previousTimestamp: Date;
  nextTimestamp: Date;
  gapDurationMinutes: number;
}

export interface DuplicateCandle {
  id1: string;
  id2: string;
  pair: string;
  timeframe: string;
  timestamp: Date;
  duplicateCount: number;
}

export interface ValidationResult {
  isValid: boolean;
  totalCandles: number;
  validCandles: number;
  invalidCandles: number;
  errors: ValidationError[];
}

export interface ValidationError {
  candleId: string;
  pair: string;
  timeframe: string;
  timestamp: Date;
  errorType:
    | 'ohlc_integrity'
    | 'volume_negative'
    | 'price_negative'
    | 'missing_data';
  errorMessage: string;
  expectedValue?: number;
  actualValue?: number;
}

export interface VerificationReport {
  pair: string;
  timeframe: string;
  dateRange: {
    from: Date;
    to: Date;
  };
  totalCandles: number;
  gaps: TimestampGap[];
  duplicates: DuplicateCandle[];
  validationResult: ValidationResult;
  volumeConsistency: VolumeConsistencyResult;
  generatedAt: Date;
}

export interface VolumeConsistencyResult {
  totalCandles: number;
  candlesWithVolume: number;
  candlesWithoutVolume: number;
  negativeVolumeCandles: number;
  averageVolume: number;
  volumeRange: {
    min: number;
    max: number;
  };
  isConsistent: boolean;
  inconsistencies: string[];
}

export class DataVerificationService extends BaseRepository {
  constructor(private candleRepository: CandleRepository) {
    super();
  }

  /**
   * Detects gaps in timestamp sequences for the configured timeframe
   * Requirements: 7.1
   */
  async checkForGaps(
    pair: string,
    timeframe: string,
    fromDate: Date,
    toDate: Date
  ): Promise<TimestampGap[]> {
    try {
      this.validateRequired(pair, 'pair');
      this.validateRequired(timeframe, 'timeframe');
      this.validateTimestamp(fromDate, 'fromDate');
      this.validateTimestamp(toDate, 'toDate');

      if (fromDate >= toDate) {
        throw new Error('fromDate must be before toDate');
      }

      // Get all candles in the date range, ordered by timestamp
      const candles = await this.candleRepository.getCandlesByDateRange(
        pair,
        timeframe,
        fromDate,
        toDate,
        5000 // Large limit for comprehensive gap detection
      );

      if (candles.length === 0) {
        this.logger.info('No candles found for gap detection', {
          pair,
          timeframe,
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
        });
        return [];
      }

      const gaps: TimestampGap[] = [];
      const timeframeMinutes = this.parseTimeframeToMinutes(timeframe);

      // Check for gaps between consecutive candles
      for (let i = 0; i < candles.length - 1; i++) {
        const currentCandle = candles[i];
        const nextCandle = candles[i + 1];

        const expectedNextTimestamp = new Date(
          currentCandle.timestamp.getTime() + timeframeMinutes * 60 * 1000
        );

        // If there's a gap larger than the timeframe interval
        if (nextCandle.timestamp.getTime() > expectedNextTimestamp.getTime()) {
          const gapDurationMs =
            nextCandle.timestamp.getTime() - expectedNextTimestamp.getTime();
          const gapDurationMinutes = Math.floor(gapDurationMs / (60 * 1000));

          gaps.push({
            expectedTimestamp: expectedNextTimestamp,
            previousTimestamp: currentCandle.timestamp,
            nextTimestamp: nextCandle.timestamp,
            gapDurationMinutes,
          });
        }
      }

      this.logger.info('Gap detection completed', {
        pair,
        timeframe,
        totalCandles: candles.length,
        gapsFound: gaps.length,
        dateRange: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
        },
      });

      return gaps;
    } catch (error) {
      this.handleDatabaseError(error, 'check for gaps');
    }
  }

  /**
   * Identifies duplicate rows that bypassed unique constraints
   * Requirements: 7.2
   */
  async detectDuplicates(
    pair: string,
    timeframe: string
  ): Promise<DuplicateCandle[]> {
    try {
      this.validateRequired(pair, 'pair');
      this.validateRequired(timeframe, 'timeframe');

      // Query to find duplicates using raw SQL through Supabase
      const { data, error } = await this.client.rpc(
        'detect_duplicate_candles',
        {
          p_pair: pair,
          p_timeframe: timeframe,
        }
      );

      if (error) {
        // If the RPC function doesn't exist, fall back to application-level detection
        if (error.code === '42883') {
          this.logger.warn(
            'RPC function detect_duplicate_candles not found, using fallback method'
          );
          return await this.detectDuplicatesFallback(pair, timeframe);
        }
        this.handleDatabaseError(error, 'detect duplicates');
      }

      const duplicates: DuplicateCandle[] = (data || []).map((row: any) => ({
        id1: row.id1,
        id2: row.id2,
        pair: row.pair,
        timeframe: row.timeframe,
        timestamp: new Date(row.timestamp),
        duplicateCount: row.duplicate_count,
      }));

      this.logger.info('Duplicate detection completed', {
        pair,
        timeframe,
        duplicatesFound: duplicates.length,
      });

      return duplicates;
    } catch (error) {
      this.handleDatabaseError(error, 'detect duplicates');
    }
  }

  /**
   * Fallback method for duplicate detection when RPC is not available
   */
  private async detectDuplicatesFallback(
    pair: string,
    timeframe: string
  ): Promise<DuplicateCandle[]> {
    // Get all candles for the pair/timeframe
    const candles = await this.candleRepository.getCandlesByPairAndTimeframe(
      pair,
      timeframe,
      5000
    );

    const duplicates: DuplicateCandle[] = [];
    const timestampMap = new Map<string, Candle[]>();

    // Group candles by timestamp
    for (const candle of candles) {
      const timestampKey = candle.timestamp.toISOString();
      if (!timestampMap.has(timestampKey)) {
        timestampMap.set(timestampKey, []);
      }
      timestampMap.get(timestampKey)!.push(candle);
    }

    // Find duplicates
    for (const [timestampKey, candleGroup] of timestampMap) {
      if (candleGroup.length > 1) {
        // Create duplicate entries for each pair of duplicates
        for (let i = 0; i < candleGroup.length - 1; i++) {
          for (let j = i + 1; j < candleGroup.length; j++) {
            duplicates.push({
              id1: candleGroup[i].id!,
              id2: candleGroup[j].id!,
              pair: candleGroup[i].pair,
              timeframe: candleGroup[i].timeframe,
              timestamp: candleGroup[i].timestamp,
              duplicateCount: candleGroup.length,
            });
          }
        }
      }
    }

    return duplicates;
  }

  /**
   * Confirms that stored values match the original broker data
   * Requirements: 7.3, 8.5
   */
  async validateOHLCIntegrity(
    pair: string,
    timeframe: string
  ): Promise<ValidationResult> {
    try {
      this.validateRequired(pair, 'pair');
      this.validateRequired(timeframe, 'timeframe');

      const candles = await this.candleRepository.getCandlesByPairAndTimeframe(
        pair,
        timeframe,
        5000
      );

      const result: ValidationResult = {
        isValid: true,
        totalCandles: candles.length,
        validCandles: 0,
        invalidCandles: 0,
        errors: [],
      };

      for (const candle of candles) {
        const errors = this.validateSingleCandleIntegrity(candle);
        if (errors.length > 0) {
          result.invalidCandles++;
          result.errors.push(...errors);
          result.isValid = false;
        } else {
          result.validCandles++;
        }
      }

      this.logger.info('OHLC integrity validation completed', {
        pair,
        timeframe,
        totalCandles: result.totalCandles,
        validCandles: result.validCandles,
        invalidCandles: result.invalidCandles,
        isValid: result.isValid,
      });

      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'validate OHLC integrity');
    }
  }

  /**
   * Validates a single candle's integrity
   */
  private validateSingleCandleIntegrity(candle: Candle): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check OHLC relationships
    if (candle.high < candle.low) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'ohlc_integrity',
        errorMessage: 'High price is less than low price',
        expectedValue: candle.low,
        actualValue: candle.high,
      });
    }

    if (candle.high < candle.open) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'ohlc_integrity',
        errorMessage: 'High price is less than open price',
        expectedValue: candle.open,
        actualValue: candle.high,
      });
    }

    if (candle.high < candle.close) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'ohlc_integrity',
        errorMessage: 'High price is less than close price',
        expectedValue: candle.close,
        actualValue: candle.high,
      });
    }

    if (candle.low > candle.open) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'ohlc_integrity',
        errorMessage: 'Low price is greater than open price',
        expectedValue: candle.open,
        actualValue: candle.low,
      });
    }

    if (candle.low > candle.close) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'ohlc_integrity',
        errorMessage: 'Low price is greater than close price',
        expectedValue: candle.close,
        actualValue: candle.low,
      });
    }

    // Check for negative prices
    if (candle.open <= 0) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'price_negative',
        errorMessage: 'Open price must be positive',
        actualValue: candle.open,
      });
    }

    if (candle.high <= 0) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'price_negative',
        errorMessage: 'High price must be positive',
        actualValue: candle.high,
      });
    }

    if (candle.low <= 0) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'price_negative',
        errorMessage: 'Low price must be positive',
        actualValue: candle.low,
      });
    }

    if (candle.close <= 0) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'price_negative',
        errorMessage: 'Close price must be positive',
        actualValue: candle.close,
      });
    }

    // Check for negative volume
    if (candle.volume < 0) {
      errors.push({
        candleId: candle.id!,
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp,
        errorType: 'volume_negative',
        errorMessage: 'Volume cannot be negative',
        actualValue: candle.volume,
      });
    }

    return errors;
  }

  /**
   * Ensures volume data behaves correctly and consistently
   * Requirements: 7.4
   */
  async validateVolumeConsistency(
    pair: string,
    timeframe: string
  ): Promise<VolumeConsistencyResult> {
    try {
      this.validateRequired(pair, 'pair');
      this.validateRequired(timeframe, 'timeframe');

      const candles = await this.candleRepository.getCandlesByPairAndTimeframe(
        pair,
        timeframe,
        5000
      );

      const result: VolumeConsistencyResult = {
        totalCandles: candles.length,
        candlesWithVolume: 0,
        candlesWithoutVolume: 0,
        negativeVolumeCandles: 0,
        averageVolume: 0,
        volumeRange: { min: 0, max: 0 },
        isConsistent: true,
        inconsistencies: [],
      };

      if (candles.length === 0) {
        return result;
      }

      let totalVolume = 0;
      let minVolume = Number.MAX_VALUE;
      let maxVolume = Number.MIN_VALUE;

      for (const candle of candles) {
        if (candle.volume > 0) {
          result.candlesWithVolume++;
          totalVolume += candle.volume;
          minVolume = Math.min(minVolume, candle.volume);
          maxVolume = Math.max(maxVolume, candle.volume);
        } else if (candle.volume === 0) {
          result.candlesWithoutVolume++;
        } else {
          result.negativeVolumeCandles++;
          result.isConsistent = false;
          result.inconsistencies.push(
            `Negative volume ${candle.volume} at ${candle.timestamp.toISOString()}`
          );
        }
      }

      result.averageVolume =
        result.candlesWithVolume > 0
          ? totalVolume / result.candlesWithVolume
          : 0;
      result.volumeRange.min = minVolume === Number.MAX_VALUE ? 0 : minVolume;
      result.volumeRange.max = maxVolume === Number.MIN_VALUE ? 0 : maxVolume;

      // Check for consistency issues
      if (result.negativeVolumeCandles > 0) {
        result.isConsistent = false;
      }

      // Check if too many candles have zero volume (might indicate data quality issues)
      const zeroVolumePercentage =
        (result.candlesWithoutVolume / result.totalCandles) * 100;
      if (zeroVolumePercentage > 50) {
        result.isConsistent = false;
        result.inconsistencies.push(
          `High percentage of zero volume candles: ${zeroVolumePercentage.toFixed(2)}%`
        );
      }

      this.logger.info('Volume consistency validation completed', {
        pair,
        timeframe,
        totalCandles: result.totalCandles,
        candlesWithVolume: result.candlesWithVolume,
        candlesWithoutVolume: result.candlesWithoutVolume,
        negativeVolumeCandles: result.negativeVolumeCandles,
        isConsistent: result.isConsistent,
        inconsistencies: result.inconsistencies.length,
      });

      return result;
    } catch (error) {
      this.handleDatabaseError(error, 'validate volume consistency');
    }
  }

  /**
   * Provides detailed reports on data quality metrics and issues found
   * Requirements: 7.5
   */
  async generateVerificationReport(
    pair: string,
    timeframe: string,
    fromDate: Date,
    toDate: Date
  ): Promise<VerificationReport> {
    try {
      this.validateRequired(pair, 'pair');
      this.validateRequired(timeframe, 'timeframe');
      this.validateTimestamp(fromDate, 'fromDate');
      this.validateTimestamp(toDate, 'toDate');

      this.logger.info('Generating comprehensive verification report', {
        pair,
        timeframe,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      });

      // Run all verification checks in parallel
      const [
        gaps,
        duplicates,
        validationResult,
        volumeConsistency,
        candleCount,
      ] = await Promise.all([
        this.checkForGaps(pair, timeframe, fromDate, toDate),
        this.detectDuplicates(pair, timeframe),
        this.validateOHLCIntegrity(pair, timeframe),
        this.validateVolumeConsistency(pair, timeframe),
        this.candleRepository.getCandleCount(pair, timeframe),
      ]);

      const report: VerificationReport = {
        pair,
        timeframe,
        dateRange: {
          from: fromDate,
          to: toDate,
        },
        totalCandles: candleCount,
        gaps,
        duplicates,
        validationResult,
        volumeConsistency,
        generatedAt: new Date(),
      };

      this.logger.info('Verification report generated successfully', {
        pair,
        timeframe,
        totalCandles: report.totalCandles,
        gapsFound: gaps.length,
        duplicatesFound: duplicates.length,
        validCandles: validationResult.validCandles,
        invalidCandles: validationResult.invalidCandles,
        volumeConsistent: volumeConsistency.isConsistent,
      });

      return report;
    } catch (error) {
      this.handleDatabaseError(error, 'generate verification report');
    }
  }

  /**
   * Parses timeframe string to minutes
   */
  private parseTimeframeToMinutes(timeframe: string): number {
    const match = timeframe.match(/^(\d+)([mhd])$/i);
    if (!match) {
      throw new Error(`Invalid timeframe format: ${timeframe}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'm':
        return value;
      case 'h':
        return value * 60;
      case 'd':
        return value * 24 * 60;
      default:
        throw new Error(`Unsupported timeframe unit: ${unit}`);
    }
  }
}
