import type { ValidationResult } from '../indicators/indicator.interface.js';
import { calculateMultiPeriodEMA } from '../indicators/ema.indicator.js';
import { calculateATR } from '../indicators/atr.indicator.js';
import { detectSwings } from '../indicators/swing.indicator.js';
import { EMARepository } from '../repositories/ema.repository.js';
import { ATRRepository } from '../repositories/atr.repository.js';
import { SwingRepository } from '../repositories/swing.repository.js';
import { CandleRepository } from '../repositories/candle.repository.js';
import { getLogger } from '../config/logger.js';
import type { Candle } from '../types/database.js';

export interface IIndicatorRunnerService {
  runHistoricalBuild(pair: string, timeframe: string): Promise<void>;
  runIncrementalUpdate(pair: string, timeframe: string): Promise<void>;
  validateIndicators(
    pair: string,
    timeframe: string
  ): Promise<ValidationResult>;
}

export class IndicatorRunnerService implements IIndicatorRunnerService {
  private readonly logger = getLogger();
  private readonly candleRepository = new CandleRepository();
  private readonly emaRepository = new EMARepository();
  private readonly atrRepository = new ATRRepository();
  private readonly swingRepository = new SwingRepository();

  /**
   * Run historical build for all indicators
   * Processes all available candle data from the earliest timestamp
   */
  async runHistoricalBuild(pair: string, timeframe: string): Promise<void> {
    try {
      this.logger.info('Starting historical indicator build', {
        pair,
        timeframe,
      });

      // Get all candles for the pair/timeframe
      const candles = await this.candleRepository.getCandlesByPairAndTimeframe(
        pair,
        timeframe,
        1000 // Maximum allowed limit
      );

      if (candles.length === 0) {
        this.logger.warn('No candles found for historical build', {
          pair,
          timeframe,
        });
        return;
      }

      this.logger.info('Processing historical candles', {
        pair,
        timeframe,
        candleCount: candles.length,
        dateRange: {
          from: candles[0]?.timestamp.toISOString(),
          to: candles[candles.length - 1]?.timestamp.toISOString(),
        },
      });

      // Clear existing indicator data for this pair/timeframe
      await this.clearExistingIndicators(pair, timeframe);

      // Calculate and persist all indicators
      await this.calculateAndPersistIndicators(candles, pair, timeframe);

      this.logger.info('Historical indicator build completed', {
        pair,
        timeframe,
        processedCandles: candles.length,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Historical indicator build failed', {
        error: errorMessage,
        pair,
        timeframe,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Historical build failed: ${errorMessage}`);
    }
  }

  /**
   * Run incremental update for indicators
   * Processes only new candles since the last calculation
   */
  async runIncrementalUpdate(pair: string, timeframe: string): Promise<void> {
    try {
      this.logger.info('Starting incremental indicator update', {
        pair,
        timeframe,
      });

      // Get the latest indicator timestamps to determine what needs updating
      const latestEMA = await this.emaRepository.getLatestEMAValue(
        pair,
        timeframe,
        20
      );
      const latestATR = await this.atrRepository.getLatestATRValue(
        pair,
        timeframe,
        14
      );
      const latestSwings = await this.swingRepository.getLatestSwingPoints(
        pair,
        timeframe,
        5
      );

      this.logger.info('Latest indicator timestamps', {
        pair,
        timeframe,
        latestEMA: latestEMA?.timestamp?.toISOString(),
        latestATR: latestATR?.timestamp?.toISOString(),
        latestSwingsCount: latestSwings.length,
        latestSwingTimestamp: latestSwings[0]?.timestamp?.toISOString(),
      });

      // Determine the earliest timestamp we need to process from
      let fromTimestamp: Date;

      if (!latestEMA && !latestATR && latestSwings.length === 0) {
        // No existing indicators, perform historical build
        this.logger.info(
          'No existing indicators found, performing historical build',
          { pair, timeframe }
        );
        await this.runHistoricalBuild(pair, timeframe);
        return;
      }

      // For incremental updates, we should process from the latest candle that was processed
      // Get the latest candle timestamp that we have indicators for
      // Use the latest timestamp among all indicators as the baseline
      const timestamps = [
        latestEMA?.timestamp,
        latestATR?.timestamp,
        latestSwings.length > 0 ? latestSwings[0]?.timestamp : undefined,
      ].filter(Boolean) as Date[];

      if (timestamps.length === 0) {
        // No indicators found, perform historical build
        this.logger.info(
          'No indicator timestamps found, performing historical build',
          { pair, timeframe }
        );
        await this.runHistoricalBuild(pair, timeframe);
        return;
      }

      fromTimestamp = new Date(Math.max(...timestamps.map(t => t.getTime())));

      this.logger.info('Calculated fromTimestamp for incremental update', {
        pair,
        timeframe,
        fromTimestamp: fromTimestamp.toISOString(),
        timestampsConsidered: timestamps.map(t => t.toISOString()),
      });

      // Get candles from the last indicator timestamp
      const newCandles = await this.candleRepository.getCandlesAfterTimestamp(
        pair,
        timeframe,
        fromTimestamp
      );

      if (newCandles.length === 0) {
        this.logger.info('No new candles to process', {
          pair,
          timeframe,
          fromTimestamp,
        });
        return;
      }

      this.logger.info('Processing incremental candles', {
        pair,
        timeframe,
        newCandleCount: newCandles.length,
        fromTimestamp: fromTimestamp.toISOString(),
        candleTimestamps: newCandles.map(c => c.timestamp.toISOString()),
      });

      // DEBUG: Log what we're about to process
      console.log(`🔍 DEBUG: Processing ${newCandles.length} candles for incremental update`);
      console.log(`🔍 DEBUG: From timestamp: ${fromTimestamp.toISOString()}`);
      console.log(`🔍 DEBUG: Candle timestamps:`, newCandles.map(c => c.timestamp.toISOString()));

      // Calculate and persist indicators for new candles
      await this.calculateAndPersistIncrementalIndicators(
        newCandles,
        pair,
        timeframe
      );

      this.logger.info('Incremental update completed', {
        pair,
        timeframe,
        processedCandles: newCandles.length,
        fromTimestamp: fromTimestamp.toISOString(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Incremental indicator update failed', {
        error: errorMessage,
        pair,
        timeframe,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`Incremental update failed: ${errorMessage}`);
    }
  }

  /**
   * Validate indicators for accuracy and consistency
   */
  async validateIndicators(
    pair: string,
    timeframe: string
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      this.logger.info('Starting indicator validation', { pair, timeframe });

      // Get sample of recent candles and indicators
      const recentCandles = await this.candleRepository.getRecentCandles(
        pair,
        timeframe,
        100
      );

      if (recentCandles.length === 0) {
        errors.push('No candles found for validation');
        return { isValid: false, errors, warnings };
      }

      // Validate EMA calculations
      await this.validateEMACalculations(
        recentCandles,
        pair,
        timeframe,
        errors,
        warnings
      );

      // Validate ATR calculations
      await this.validateATRCalculations(
        recentCandles,
        pair,
        timeframe,
        errors,
        warnings
      );

      // Validate swing point detection
      await this.validateSwingDetection(
        recentCandles,
        pair,
        timeframe,
        errors,
        warnings
      );

      const isValid = errors.length === 0;

      this.logger.info('Indicator validation completed', {
        pair,
        timeframe,
        isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
      });

      return { isValid, errors, warnings };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Validation failed: ${errorMessage}`);

      this.logger.error('Indicator validation failed', {
        error: errorMessage,
        pair,
        timeframe,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return { isValid: false, errors, warnings };
    }
  }

  /**
   * Calculate and persist all indicators for a set of candles
   */
  private async calculateAndPersistIndicators(
    candles: Candle[],
    pair: string,
    timeframe: string
  ): Promise<void> {
    // Calculate EMA for periods 20, 50, 200
    const emaResults = calculateMultiPeriodEMA(candles);

    // Calculate ATR with 14-period
    const atrResults = calculateATR(candles, 14);

    // Detect swing points with 5-period lookback
    const swingPoints = detectSwings(candles, 5);

    // Persist EMA values
    for (const [period, results] of emaResults.entries()) {
      if (results.length > 0) {
        const emaValues = results.map(result => ({
          pair,
          timeframe,
          timestamp: result.timestamp,
          period: result.period,
          value: result.value,
        }));

        try {
          await this.emaRepository.insertEMAValues(emaValues);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('does not exist')
          ) {
            this.logger.warn(
              `EMA table does not exist - indicators calculated but not persisted`,
              {
                pair,
                timeframe,
                period,
                count: emaValues.length,
              }
            );
          } else {
            throw error;
          }
        }
      }
    }

    // Persist ATR values
    if (atrResults.length > 0) {
      const atrValues = atrResults.map(result => ({
        pair,
        timeframe,
        timestamp: result.timestamp,
        period: result.period,
        value: result.value,
      }));

      try {
        await this.atrRepository.insertATRValues(atrValues);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('does not exist')
        ) {
          this.logger.warn(
            `ATR table does not exist - indicators calculated but not persisted`,
            {
              pair,
              timeframe,
              count: atrValues.length,
            }
          );
        } else {
          throw error;
        }
      }
    }

    // Persist swing points
    if (swingPoints.length > 0) {
      try {
        await this.swingRepository.insertSwingPoints(swingPoints);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('does not exist')
        ) {
          this.logger.warn(
            `Swing points table does not exist - indicators calculated but not persisted`,
            {
              pair,
              timeframe,
              count: swingPoints.length,
            }
          );
        } else {
          throw error;
        }
      }
    }

    this.logger.debug(
      'Indicators calculated and persisted (where tables exist)',
      {
        pair,
        timeframe,
        emaCount: Array.from(emaResults.values()).reduce(
          (sum, results) => sum + results.length,
          0
        ),
        atrCount: atrResults.length,
        swingCount: swingPoints.length,
      }
    );
  }

  /**
   * Calculate and persist indicators incrementally
   */
  private async calculateAndPersistIncrementalIndicators(
    candles: Candle[],
    pair: string,
    timeframe: string
  ): Promise<void> {
    this.logger.info('Starting incremental calculation', {
      pair,
      timeframe,
      candleCount: candles.length,
      candleTimestamps: candles.map(c => c.timestamp.toISOString()),
    });
    // Get previous EMA values for incremental calculation
    const previousEMAs = new Map<number, number>();
    for (const period of [20, 50, 200]) {
      const latestEMA = await this.emaRepository.getLatestEMAValue(
        pair,
        timeframe,
        period
      );
      if (latestEMA) {
        previousEMAs.set(period, latestEMA.value);
      }
    }

    // Get previous ATR value
    const latestATR = await this.atrRepository.getLatestATRValue(
      pair,
      timeframe,
      14
    );
    const previousATR = latestATR?.value;

    // Calculate indicators with previous values
    const emaResults = calculateMultiPeriodEMA(candles, previousEMAs);
    const atrResults = calculateATR(candles, 14, previousATR);
    const swingPoints = detectSwings(candles, 5);

    // Persist EMA values
    for (const [period, results] of emaResults.entries()) {
      if (results.length > 0) {
        const emaValues = results.map(result => ({
          pair,
          timeframe,
          timestamp: result.timestamp,
          period: result.period,
          value: result.value,
        }));

        try {
          await this.emaRepository.insertEMAValues(emaValues);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('does not exist')
          ) {
            this.logger.warn(
              `EMA table does not exist - indicators calculated but not persisted`,
              {
                pair,
                timeframe,
                period,
                count: emaValues.length,
              }
            );
          } else {
            throw error;
          }
        }
      }
    }

    // Persist ATR values
    if (atrResults.length > 0) {
      const atrValues = atrResults.map(result => ({
        pair,
        timeframe,
        timestamp: result.timestamp,
        period: result.period,
        value: result.value,
      }));

      try {
        await this.atrRepository.insertATRValues(atrValues);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('does not exist')
        ) {
          this.logger.warn(
            `ATR table does not exist - indicators calculated but not persisted`,
            {
              pair,
              timeframe,
              count: atrValues.length,
            }
          );
        } else {
          throw error;
        }
      }
    }

    // Persist swing points
    if (swingPoints.length > 0) {
      try {
        await this.swingRepository.insertSwingPoints(swingPoints);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('does not exist')
        ) {
          this.logger.warn(
            `Swing points table does not exist - indicators calculated but not persisted`,
            {
              pair,
              timeframe,
              count: swingPoints.length,
            }
          );
        } else {
          throw error;
        }
      }
    }

    this.logger.debug(
      'Incremental indicators calculated and persisted (where tables exist)',
      {
        pair,
        timeframe,
        emaCount: Array.from(emaResults.values()).reduce(
          (sum, results) => sum + results.length,
          0
        ),
        atrCount: atrResults.length,
        swingCount: swingPoints.length,
      }
    );
  }

  /**
   * Clear existing indicator data for a pair/timeframe
   */
  private async clearExistingIndicators(
    pair: string,
    timeframe: string
  ): Promise<void> {
    try {
      await Promise.all([
        this.emaRepository.deleteEMAValues(pair, timeframe).catch(error => {
          if (error.message.includes('does not exist')) {
            this.logger.debug('EMA table does not exist - skipping cleanup', {
              pair,
              timeframe,
            });
          } else {
            throw error;
          }
        }),
        this.atrRepository.deleteATRValues(pair, timeframe).catch(error => {
          if (error.message.includes('does not exist')) {
            this.logger.debug('ATR table does not exist - skipping cleanup', {
              pair,
              timeframe,
            });
          } else {
            throw error;
          }
        }),
        this.swingRepository.deleteSwingPoints(pair, timeframe).catch(error => {
          if (error.message.includes('does not exist')) {
            this.logger.debug(
              'Swing points table does not exist - skipping cleanup',
              { pair, timeframe }
            );
          } else {
            throw error;
          }
        }),
      ]);

      this.logger.debug(
        'Existing indicators cleared (or tables do not exist)',
        { pair, timeframe }
      );
    } catch (error) {
      this.logger.warn('Failed to clear some indicator data', {
        pair,
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - continue with the build even if cleanup fails
    }
  }

  /**
   * Validate EMA calculations against reference values
   */
  private async validateEMACalculations(
    candles: Candle[],
    pair: string,
    timeframe: string,
    errors: string[],
    warnings: string[]
  ): Promise<void> {
    try {
      // Recalculate EMA and compare with stored values
      const calculatedEMAs = calculateMultiPeriodEMA(candles);

      for (const [period, results] of calculatedEMAs.entries()) {
        if (results.length > 0) {
          const latestCalculated = results[results.length - 1];
          if (latestCalculated) {
            const storedEMA = await this.emaRepository.getLatestEMAValue(
              pair,
              timeframe,
              period
            );

            if (storedEMA) {
              const difference = Math.abs(
                latestCalculated.value - storedEMA.value
              );
              const tolerance = storedEMA.value * 0.0001; // 0.01% tolerance

              if (difference > tolerance) {
                errors.push(
                  `EMA ${period} validation failed: calculated=${latestCalculated.value}, stored=${storedEMA.value}, difference=${difference}`
                );
              }
            } else {
              warnings.push(
                `No stored EMA ${period} value found for comparison`
              );
            }
          }
        }
      }
    } catch (error) {
      errors.push(
        `EMA validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate ATR calculations against reference values
   */
  private async validateATRCalculations(
    candles: Candle[],
    pair: string,
    timeframe: string,
    errors: string[],
    warnings: string[]
  ): Promise<void> {
    try {
      // Recalculate ATR and compare with stored values
      const calculatedATR = calculateATR(candles, 14);

      if (calculatedATR.length > 0) {
        const latestCalculated = calculatedATR[calculatedATR.length - 1];
        if (latestCalculated) {
          const storedATR = await this.atrRepository.getLatestATRValue(
            pair,
            timeframe,
            14
          );

          if (storedATR) {
            const difference = Math.abs(
              latestCalculated.value - storedATR.value
            );
            const tolerance = storedATR.value * 0.0001; // 0.01% tolerance

            if (difference > tolerance) {
              errors.push(
                `ATR validation failed: calculated=${latestCalculated.value}, stored=${storedATR.value}, difference=${difference}`
              );
            }
          } else {
            warnings.push('No stored ATR value found for comparison');
          }
        }
      }
    } catch (error) {
      errors.push(
        `ATR validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate swing point detection consistency
   */
  private async validateSwingDetection(
    candles: Candle[],
    pair: string,
    timeframe: string,
    errors: string[],
    warnings: string[]
  ): Promise<void> {
    try {
      // Recalculate swing points and compare with stored values
      const calculatedSwings = detectSwings(candles, 5);
      const storedSwings = await this.swingRepository.getLatestSwingPoints(
        pair,
        timeframe,
        5
      );

      if (calculatedSwings.length !== storedSwings.length) {
        warnings.push(
          `Swing point count mismatch: calculated=${calculatedSwings.length}, stored=${storedSwings.length}`
        );
      }

      // Check for position changes in recent swing points
      const recentCalculated = calculatedSwings.slice(-5);
      const recentStored = storedSwings.slice(0, 5);

      for (
        let i = 0;
        i < Math.min(recentCalculated.length, recentStored.length);
        i++
      ) {
        const calc = recentCalculated[i];
        const stored = recentStored[i];

        if (
          calc &&
          stored &&
          (calc.timestamp.getTime() !== stored.timestamp.getTime() ||
            calc.type !== stored.type ||
            Math.abs(calc.price - stored.price) > 0.00001)
        ) {
          errors.push(
            `Swing point mismatch at index ${i}: calculated=${JSON.stringify(calc)}, stored=${JSON.stringify(stored)}`
          );
        }
      }
    } catch (error) {
      errors.push(
        `Swing validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
