import { BrokerAdapter } from '../brokers/broker.interface.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { CandleNormalizer, NormalizedCandle } from './candle-normalizer.js';
import {
  TradingSessionFilter,
  createXauUsdTradingSessionFilter,
} from '../utils/trading-session.js';
import {
  CandleRepository,
  BatchInsertResult,
} from '../repositories/candle.repository.js';
import { logger } from '../config/logger.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { 
  errorRecoveryService, 
  RecoveryContext,
  ErrorClassification 
} from './error-recovery.service.js';

/**
 * Candle Ingestion Service
 *
 * Orchestrates the complete ingestion pipeline:
 * 1. Fetch candles from broker
 * 2. Normalize candle data
 * 3. Filter by trading session
 * 4. Store in repository
 */

export interface IngestionResult {
  totalFetched: number;
  totalNormalized: number;
  totalFiltered: number;
  totalInserted: number;
  totalSkipped: number;
  errors: string[];
  lastProcessedTimestamp: Date | null;
  processingTimeMs: number;
}

export interface BackfillResult extends IngestionResult {
  dateRangeProcessed: {
    fromDate: Date;
    toDate: Date;
  };
  batchesProcessed: number;
  averageBatchTimeMs: number;
}

export interface IncrementalResult extends IngestionResult {
  lastKnownTimestamp: Date | null;
  newCandlesFound: boolean;
  gapDetected: boolean;
  gapDetails?: {
    expectedTimestamp: Date;
    actualTimestamp: Date;
    gapDurationMs: number;
  };
}

export interface IngestionConfig {
  pair: string;
  timeframe: string;
  brokerName?: string;
  enableSessionFiltering: boolean;
  batchSize: number;
  maxRetries: number;
}

export class IngestionError extends Error {
  constructor(
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export class CandleIngestionService {
  private broker: BrokerAdapter;
  private normalizer: CandleNormalizer;
  private sessionFilter: TradingSessionFilter;
  private candleRepository: CandleRepository;
  private isInterrupted: boolean = false;

  constructor(
    broker?: BrokerAdapter,
    normalizer?: CandleNormalizer,
    sessionFilter?: TradingSessionFilter,
    candleRepository?: CandleRepository
  ) {
    this.broker = broker || BrokerFactory.createActiveBroker();
    this.normalizer = normalizer || new CandleNormalizer();
    this.sessionFilter = sessionFilter || createXauUsdTradingSessionFilter();
    this.candleRepository = candleRepository || new CandleRepository();
  }

  /**
   * Ingests candles for a specific date range with performance monitoring
   */
  async ingestCandles(
    config: IngestionConfig,
    fromDate: Date,
    toDate: Date
  ): Promise<IngestionResult> {
    const benchmarkId = performanceMonitor.startBenchmark(
      'candle-ingestion',
      {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        dateRange: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
        },
        config,
      }
    );

    const startTime = Date.now();

    const result: IngestionResult = {
      totalFetched: 0,
      totalNormalized: 0,
      totalFiltered: 0,
      totalInserted: 0,
      totalSkipped: 0,
      errors: [],
      lastProcessedTimestamp: null,
      processingTimeMs: 0,
    };

    try {
      logger.info('Starting candle ingestion', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        enableSessionFiltering: config.enableSessionFiltering,
      });

      // Step 1: Fetch candles from broker with performance monitoring
      const brokerCandles = await this.fetchCandlesWithRetry(
        config.pair,
        config.timeframe,
        fromDate,
        toDate,
        config.maxRetries
      );

      result.totalFetched = brokerCandles.length;

      if (brokerCandles.length === 0) {
        logger.info('No candles fetched from broker', {
          pair: config.pair,
          timeframe: config.timeframe,
          broker: this.broker.getBrokerName(),
        });
        result.processingTimeMs = Date.now() - startTime;
        performanceMonitor.endBenchmark(benchmarkId);
        return result;
      }

      // Step 2: Normalize candles with memory monitoring
      const memoryBefore = process.memoryUsage();
      const normalizedCandles = this.normalizer.normalizeMany(
        brokerCandles,
        config.pair,
        config.timeframe,
        this.broker.getBrokerName()
      );
      const memoryAfter = process.memoryUsage();

      result.totalNormalized = normalizedCandles.length;

      // Log memory usage for normalization
      const memoryDelta = Math.round(
        (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024
      );
      logger.debug('Normalization memory usage', {
        candleCount: brokerCandles.length,
        memoryDeltaMB: memoryDelta,
        heapUsedMB: Math.round(memoryAfter.heapUsed / 1024 / 1024),
      });

      if (normalizedCandles.length === 0) {
        logger.warn('No candles survived normalization', {
          pair: config.pair,
          timeframe: config.timeframe,
          originalCount: brokerCandles.length,
        });
        result.processingTimeMs = Date.now() - startTime;
        performanceMonitor.endBenchmark(benchmarkId);
        return result;
      }

      // Step 3: Filter by trading session (if enabled)
      let filteredCandles = normalizedCandles;
      if (config.enableSessionFiltering) {
        filteredCandles = this.filterByTradingSession(normalizedCandles);
        result.totalFiltered = filteredCandles.length;

        const filteredOut = normalizedCandles.length - filteredCandles.length;
        if (filteredOut > 0) {
          logger.info('Candles filtered by trading session', {
            originalCount: normalizedCandles.length,
            filteredCount: filteredCandles.length,
            filteredOut,
          });
        }
      } else {
        result.totalFiltered = normalizedCandles.length;
      }

      if (filteredCandles.length === 0) {
        logger.info('No candles within trading session', {
          pair: config.pair,
          timeframe: config.timeframe,
          originalCount: normalizedCandles.length,
        });
        result.processingTimeMs = Date.now() - startTime;
        performanceMonitor.endBenchmark(benchmarkId);
        return result;
      }

      // Step 4: Store candles in batches with performance optimization
      const batchResults = await this.storeCandlesInBatches(
        filteredCandles,
        config.batchSize
      );

      // Aggregate batch results
      for (const batchResult of batchResults) {
        result.totalInserted += batchResult.insertedCandles;
        result.totalSkipped += batchResult.skippedCandles;
        result.errors.push(...batchResult.errors.map(e => e.error));
      }

      // Set last processed timestamp
      if (filteredCandles.length > 0) {
        const sortedCandles = [...filteredCandles].sort(
          (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
        );
        result.lastProcessedTimestamp = sortedCandles[0].timestamp;
      }

      result.processingTimeMs = Date.now() - startTime;

      // End performance monitoring and calculate throughput
      const metrics = performanceMonitor.endBenchmark(benchmarkId);
      if (metrics && result.processingTimeMs > 0) {
        metrics.throughput.candlesPerSecond = 
          (result.totalInserted / result.processingTimeMs) * 1000;
        metrics.systemLoad.queueSize = filteredCandles.length;
      }

      logger.info('Candle ingestion completed', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        result,
        processingTimeMs: result.processingTimeMs,
        throughputCandlesPerSec: result.processingTimeMs > 0 ? 
          ((result.totalInserted / result.processingTimeMs) * 1000).toFixed(2) : '0',
      });

      return result;
    } catch (error) {
      result.processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown ingestion error';
      result.errors.push(errorMessage);

      performanceMonitor.endBenchmark(benchmarkId);

      logger.error('Candle ingestion failed', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        error: errorMessage,
        processingTimeMs: result.processingTimeMs,
      });

      throw new IngestionError(
        `Ingestion failed for ${config.pair} ${config.timeframe}: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Fetches candles from broker with enhanced error recovery
   */
  private async fetchCandlesWithRetry(
    pair: string,
    timeframe: string,
    fromDate: Date,
    toDate: Date,
    maxRetries: number
  ) {
    const operationId = `fetch_candles_${pair}_${timeframe}_${Date.now()}`;
    
    const context: RecoveryContext = {
      operationId,
      operationType: 'fetch_candles',
      attemptCount: 0,
      startTime: new Date(),
      metadata: {
        pair,
        timeframe,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        endpoint: `/v3/instruments/${pair}/candles`,
        broker: this.broker.getBrokerName(),
      },
    };

    const operation = async () => {
      logger.debug('Fetching candles from broker', {
        pair,
        timeframe,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        broker: this.broker.getBrokerName(),
      });

      return await this.broker.fetchCandles(
        pair,
        timeframe,
        fromDate,
        toDate
      );
    };

    try {
      // First attempt without error recovery
      return await operation();
    } catch (error) {
      const brokerError = error instanceof Error ? error : new Error('Unknown broker error');
      context.lastError = brokerError;
      
      logger.info('Initial fetch failed, initiating error recovery', {
        operationId,
        error: brokerError.message,
        broker: this.broker.getBrokerName(),
      });

      // Classify the error and execute recovery strategy
      const classification = errorRecoveryService.classifyError(brokerError);
      
      logger.debug('Error classified for recovery', {
        operationId,
        classification,
      });

      try {
        const { result, recoveryResult } = await errorRecoveryService.executeRecovery(
          context,
          operation,
          classification
        );

        logger.info('Error recovery completed successfully', {
          operationId,
          strategy: recoveryResult.strategy,
          attemptCount: recoveryResult.attemptCount,
          totalTimeMs: recoveryResult.totalTimeMs,
          candleCount: result.length,
        });

        return result;
      } catch (recoveryError) {
        const finalError = recoveryError instanceof Error ? recoveryError : new Error('Recovery failed');
        
        logger.error('Error recovery failed', {
          operationId,
          originalError: brokerError.message,
          recoveryError: finalError.message,
          broker: this.broker.getBrokerName(),
        });

        throw new IngestionError(
          `Failed to fetch candles after error recovery: ${finalError.message}`,
          finalError
        );
      }
    }
  }

  /**
   * Filters candles by trading session
   */
  private filterByTradingSession(
    candles: NormalizedCandle[]
  ): NormalizedCandle[] {
    const filtered = candles.filter(candle =>
      this.sessionFilter.isWithinTradingHours(candle.timestamp)
    );

    const stats = this.sessionFilter.getFilteringStats(
      candles.map(c => c.timestamp)
    );

    logger.debug('Trading session filtering applied', {
      originalCount: candles.length,
      filteredCount: filtered.length,
      stats,
    });

    return filtered;
  }

  /**
   * Stores candles in the repository using optimized batch operations
   */
  private async storeCandlesInBatches(
    candles: NormalizedCandle[],
    batchSize: number
  ): Promise<BatchInsertResult[]> {
    const results: BatchInsertResult[] = [];

    // Optimize batch size based on data volume
    const optimizedBatchSize = this.getOptimizedBatchSize(candles.length, batchSize);

    for (let i = 0; i < candles.length; i += optimizedBatchSize) {
      // Check for interruption
      if (this.isInterrupted) {
        logger.info('Batch processing interrupted', {
          processedBatches: Math.floor(i / optimizedBatchSize),
          totalBatches: Math.ceil(candles.length / optimizedBatchSize),
        });
        break;
      }

      const batch = candles.slice(i, i + optimizedBatchSize);

      logger.debug('Processing candle batch', {
        batchNumber: Math.floor(i / optimizedBatchSize) + 1,
        batchSize: batch.length,
        totalBatches: Math.ceil(candles.length / optimizedBatchSize),
        optimizedBatchSize,
      });

      try {
        // Add timeout handling for database operations
        const batchResult = await this.executeWithTimeout(
          () => this.candleRepository.insertNormalizedCandles(batch),
          30000, // 30 second timeout for database operations
          `batch_insert_${Math.floor(i / optimizedBatchSize) + 1}`
        );
        results.push(batchResult);

        if (batchResult.errors.length > 0) {
          logger.warn('Batch had errors', {
            batchNumber: Math.floor(i / optimizedBatchSize) + 1,
            errorCount: batchResult.errors.length,
            insertedCount: batchResult.insertedCandles,
            skippedCount: batchResult.skippedCandles,
          });
        }

        // Add small delay between batches to prevent overwhelming the database
        if (i + optimizedBatchSize < candles.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (error) {
        logger.error('Batch insertion failed', {
          batchNumber: Math.floor(i / optimizedBatchSize) + 1,
          batchSize: batch.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Create a failed batch result
        results.push({
          totalCandles: batch.length,
          insertedCandles: 0,
          skippedCandles: 0,
          errors: [
            {
              candle: batch[0],
              error:
                error instanceof Error
                  ? error.message
                  : 'Batch insertion failed',
            },
          ],
        });
      }
    }

    return results;
  }

  /**
   * Calculates optimized batch size based on data volume and system resources
   */
  private getOptimizedBatchSize(totalCandles: number, requestedBatchSize: number): number {
    // Get current memory usage
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    // Adjust batch size based on memory pressure
    let optimizedSize = requestedBatchSize;
    
    if (heapUsedMB > 256) {
      // High memory usage - reduce batch size
      optimizedSize = Math.max(10, Math.floor(requestedBatchSize * 0.5));
    } else if (heapUsedMB < 128 && totalCandles > 1000) {
      // Low memory usage and large dataset - increase batch size
      optimizedSize = Math.min(500, Math.floor(requestedBatchSize * 1.5));
    }
    
    // Ensure batch size is reasonable for the dataset
    if (totalCandles < optimizedSize) {
      optimizedSize = totalCandles;
    }
    
    logger.debug('Optimized batch size calculated', {
      requestedBatchSize,
      optimizedSize,
      totalCandles,
      heapUsedMB,
    });
    
    return optimizedSize;
  }

  /**
   * Updates the broker adapter
   */
  setBroker(broker: BrokerAdapter): void {
    this.broker = broker;
    logger.info('Broker adapter updated', {
      brokerName: broker.getBrokerName(),
    });
  }

  /**
   * Updates the normalization configuration
   */
  updateNormalizationConfig(config: any): void {
    this.normalizer.updateConfig(config);
    logger.info('Normalization configuration updated');
  }

  /**
   * Updates the trading session filter
   */
  setTradingSessionFilter(filter: TradingSessionFilter): void {
    this.sessionFilter = filter;
    logger.info('Trading session filter updated', {
      config: filter.getConfig(),
    });
  }

  /**
   * Gets the current broker name
   */
  getBrokerName(): string {
    return this.broker.getBrokerName();
  }

  /**
   * Performs historical backfill for a date range
   */
  async backfillHistoricalData(
    config: IngestionConfig,
    fromDate: Date,
    toDate: Date,
    maxDaysPerBatch: number = 7
  ): Promise<BackfillResult> {
    const startTime = Date.now();

    logger.info('Starting historical backfill', {
      pair: config.pair,
      timeframe: config.timeframe,
      broker: this.broker.getBrokerName(),
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      maxDaysPerBatch,
    });

    // Validate date range
    if (fromDate >= toDate) {
      throw new IngestionError('fromDate must be before toDate');
    }

    if (toDate > new Date()) {
      throw new IngestionError('toDate cannot be in the future');
    }

    const result: BackfillResult = {
      totalFetched: 0,
      totalNormalized: 0,
      totalFiltered: 0,
      totalInserted: 0,
      totalSkipped: 0,
      errors: [],
      lastProcessedTimestamp: null,
      processingTimeMs: 0,
      dateRangeProcessed: { fromDate, toDate },
      batchesProcessed: 0,
      averageBatchTimeMs: 0,
    };

    try {
      // Split date range into manageable batches
      const dateBatches = this.createDateBatches(
        fromDate,
        toDate,
        maxDaysPerBatch
      );
      const batchTimes: number[] = [];

      logger.info('Backfill date batches created', {
        totalBatches: dateBatches.length,
        maxDaysPerBatch,
        dateRange: `${fromDate.toISOString()} to ${toDate.toISOString()}`,
      });

      // Process each batch in chronological order
      for (let i = 0; i < dateBatches.length; i++) {
        // Check for interruption
        if (this.isInterrupted) {
          logger.info('Backfill interrupted by user request', {
            batchNumber: i + 1,
            totalBatches: dateBatches.length,
            processedBatches: result.batchesProcessed,
          });
          break;
        }

        const batch = dateBatches[i];
        const batchStartTime = Date.now();

        logger.info('Processing backfill batch', {
          batchNumber: i + 1,
          totalBatches: dateBatches.length,
          batchFromDate: batch.fromDate.toISOString(),
          batchToDate: batch.toDate.toISOString(),
        });

        try {
          const batchResult = await this.ingestCandles(
            config,
            batch.fromDate,
            batch.toDate
          );

          // Aggregate results
          result.totalFetched += batchResult.totalFetched;
          result.totalNormalized += batchResult.totalNormalized;
          result.totalFiltered += batchResult.totalFiltered;
          result.totalInserted += batchResult.totalInserted;
          result.totalSkipped += batchResult.totalSkipped;
          result.errors.push(...batchResult.errors);

          // Update last processed timestamp
          if (batchResult.lastProcessedTimestamp) {
            if (
              !result.lastProcessedTimestamp ||
              batchResult.lastProcessedTimestamp > result.lastProcessedTimestamp
            ) {
              result.lastProcessedTimestamp =
                batchResult.lastProcessedTimestamp;
            }
          }

          const batchTime = Date.now() - batchStartTime;
          batchTimes.push(batchTime);
          result.batchesProcessed++;

          logger.info('Backfill batch completed', {
            batchNumber: i + 1,
            batchTimeMs: batchTime,
            batchResult: {
              fetched: batchResult.totalFetched,
              inserted: batchResult.totalInserted,
              skipped: batchResult.totalSkipped,
              errors: batchResult.errors.length,
            },
          });

          // Store progress after each batch
          await this.storeBackfillProgress(config, batch.toDate);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown batch error';
          result.errors.push(`Batch ${i + 1} failed: ${errorMessage}`);

          logger.error('Backfill batch failed', {
            batchNumber: i + 1,
            batchFromDate: batch.fromDate.toISOString(),
            batchToDate: batch.toDate.toISOString(),
            error: errorMessage,
          });

          // Continue with next batch unless it's a critical error
          if (
            error instanceof IngestionError &&
            error.message.includes('authentication')
          ) {
            throw error; // Stop on authentication errors
          }
        }
      }

      // Calculate averages
      result.averageBatchTimeMs =
        batchTimes.length > 0
          ? Math.round(
              batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length
            )
          : 0;

      result.processingTimeMs = Date.now() - startTime;

      logger.info('Historical backfill completed', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        result: {
          totalFetched: result.totalFetched,
          totalInserted: result.totalInserted,
          totalSkipped: result.totalSkipped,
          batchesProcessed: result.batchesProcessed,
          errors: result.errors.length,
          processingTimeMs: result.processingTimeMs,
          averageBatchTimeMs: result.averageBatchTimeMs,
        },
      });

      return result;
    } catch (error) {
      result.processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown backfill error';

      logger.error('Historical backfill failed', {
        pair: config.pair,
        timeframe: config.timeframe,
        error: errorMessage,
        processingTimeMs: result.processingTimeMs,
      });

      throw new IngestionError(
        `Historical backfill failed: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Creates date batches for processing large date ranges
   */
  private createDateBatches(
    fromDate: Date,
    toDate: Date,
    maxDaysPerBatch: number
  ): Array<{ fromDate: Date; toDate: Date }> {
    const batches: Array<{ fromDate: Date; toDate: Date }> = [];
    const msPerDay = 24 * 60 * 60 * 1000;
    const maxMsPerBatch = maxDaysPerBatch * msPerDay;

    let currentStart = new Date(fromDate);

    while (currentStart < toDate) {
      let currentEnd = new Date(currentStart.getTime() + maxMsPerBatch);

      // Don't exceed the target end date
      if (currentEnd > toDate) {
        currentEnd = new Date(toDate);
      }

      batches.push({
        fromDate: new Date(currentStart),
        toDate: new Date(currentEnd),
      });

      // Move to next batch
      currentStart = new Date(currentEnd.getTime() + 1); // Add 1ms to avoid overlap
    }

    return batches;
  }

  /**
   * Stores backfill progress for resumption
   */
  private async storeBackfillProgress(
    config: IngestionConfig,
    lastProcessedDate: Date
  ): Promise<void> {
    try {
      // This could be stored in a separate progress table or configuration
      // For now, we'll just log the progress
      logger.info('Backfill progress checkpoint', {
        pair: config.pair,
        timeframe: config.timeframe,
        lastProcessedDate: lastProcessedDate.toISOString(),
      });

      // In a production system, you might want to store this in the database
      // or a configuration service for resumption capabilities
    } catch (error) {
      logger.warn('Failed to store backfill progress', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Performs incremental update to fetch only the latest candles
   */
  async updateIncremental(
    config: IngestionConfig,
    lookbackHours: number = 24
  ): Promise<IncrementalResult> {
    const startTime = Date.now();

    logger.info('Starting incremental update', {
      pair: config.pair,
      timeframe: config.timeframe,
      broker: this.broker.getBrokerName(),
      lookbackHours,
    });

    const result: IncrementalResult = {
      totalFetched: 0,
      totalNormalized: 0,
      totalFiltered: 0,
      totalInserted: 0,
      totalSkipped: 0,
      errors: [],
      lastProcessedTimestamp: null,
      processingTimeMs: 0,
      lastKnownTimestamp: null,
      newCandlesFound: false,
      gapDetected: false,
    };

    try {
      // Get the latest candle timestamp from the database with timeout
      const latestTimestamp = await this.executeWithTimeout(
        () => this.candleRepository.getLatestCandleTimestamp(
          config.pair,
          config.timeframe
        ),
        10000, // 10 second timeout for timestamp query
        'get_latest_timestamp'
      );

      result.lastKnownTimestamp = latestTimestamp;

      // Determine the start date for incremental fetch
      const now = new Date();
      let fromDate: Date;

      if (latestTimestamp) {
        // Start from the latest known timestamp
        fromDate = new Date(latestTimestamp.getTime() + 1); // Add 1ms to avoid overlap

        // Check for potential gaps
        const timeSinceLastCandle = now.getTime() - latestTimestamp.getTime();
        const expectedIntervalMs = this.getTimeframeIntervalMs(
          config.timeframe
        );

        if (timeSinceLastCandle > expectedIntervalMs * 2) {
          result.gapDetected = true;
          result.gapDetails = {
            expectedTimestamp: new Date(
              latestTimestamp.getTime() + expectedIntervalMs
            ),
            actualTimestamp: now,
            gapDurationMs: timeSinceLastCandle,
          };

          logger.warn('Potential data gap detected', {
            pair: config.pair,
            timeframe: config.timeframe,
            lastKnownTimestamp: latestTimestamp.toISOString(),
            timeSinceLastCandle,
            expectedIntervalMs,
            gapDetails: result.gapDetails,
          });
        }
      } else {
        // No existing data, fetch from lookback period
        fromDate = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

        logger.info('No existing data found, using lookback period', {
          pair: config.pair,
          timeframe: config.timeframe,
          lookbackHours,
          fromDate: fromDate.toISOString(),
        });
      }

      // Ensure we don't fetch future data
      const toDate = new Date(Math.min(now.getTime(), Date.now()));

      if (fromDate >= toDate) {
        logger.info('No new data to fetch', {
          pair: config.pair,
          timeframe: config.timeframe,
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
        });

        result.processingTimeMs = Date.now() - startTime;
        return result;
      }

      // Perform the incremental ingestion
      const ingestionResult = await this.ingestCandles(
        config,
        fromDate,
        toDate
      );

      // Copy results
      result.totalFetched = ingestionResult.totalFetched;
      result.totalNormalized = ingestionResult.totalNormalized;
      result.totalFiltered = ingestionResult.totalFiltered;
      result.totalInserted = ingestionResult.totalInserted;
      result.totalSkipped = ingestionResult.totalSkipped;
      result.errors = ingestionResult.errors;
      result.lastProcessedTimestamp = ingestionResult.lastProcessedTimestamp;
      result.newCandlesFound = ingestionResult.totalInserted > 0;

      result.processingTimeMs = Date.now() - startTime;

      logger.info('Incremental update completed', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        result: {
          newCandlesFound: result.newCandlesFound,
          totalFetched: result.totalFetched,
          totalInserted: result.totalInserted,
          totalSkipped: result.totalSkipped,
          gapDetected: result.gapDetected,
          errors: result.errors.length,
          processingTimeMs: result.processingTimeMs,
        },
      });

      return result;
    } catch (error) {
      result.processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown incremental update error';
      result.errors.push(errorMessage);

      logger.error('Incremental update failed', {
        pair: config.pair,
        timeframe: config.timeframe,
        broker: this.broker.getBrokerName(),
        error: errorMessage,
        processingTimeMs: result.processingTimeMs,
      });

      throw new IngestionError(
        `Incremental update failed for ${config.pair} ${config.timeframe}: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Gets the interval in milliseconds for a given timeframe
   */
  private getTimeframeIntervalMs(timeframe: string): number {
    const intervals: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000, // Approximate
    };

    return intervals[timeframe] || 15 * 60 * 1000; // Default to 15 minutes
  }

  /**
   * Performs a smart incremental update that handles gaps automatically
   */
  async smartIncrementalUpdate(
    config: IngestionConfig,
    maxGapFillDays: number = 7
  ): Promise<IncrementalResult> {
    const incrementalResult = await this.updateIncremental(config);

    // If a gap is detected and it's within the acceptable range, try to fill it
    if (
      incrementalResult.gapDetected &&
      incrementalResult.gapDetails &&
      incrementalResult.lastKnownTimestamp
    ) {
      const gapDays =
        incrementalResult.gapDetails.gapDurationMs / (24 * 60 * 60 * 1000);

      if (gapDays <= maxGapFillDays) {
        logger.info('Attempting to fill detected gap', {
          pair: config.pair,
          timeframe: config.timeframe,
          gapDays: Math.round(gapDays * 100) / 100,
          maxGapFillDays,
        });

        try {
          // Fill the gap
          const gapFillResult = await this.ingestCandles(
            config,
            incrementalResult.lastKnownTimestamp,
            incrementalResult.gapDetails.actualTimestamp
          );

          // Update results with gap fill data
          incrementalResult.totalFetched += gapFillResult.totalFetched;
          incrementalResult.totalNormalized += gapFillResult.totalNormalized;
          incrementalResult.totalFiltered += gapFillResult.totalFiltered;
          incrementalResult.totalInserted += gapFillResult.totalInserted;
          incrementalResult.totalSkipped += gapFillResult.totalSkipped;
          incrementalResult.errors.push(...gapFillResult.errors);

          if (gapFillResult.lastProcessedTimestamp) {
            incrementalResult.lastProcessedTimestamp =
              gapFillResult.lastProcessedTimestamp;
          }

          logger.info('Gap fill completed', {
            pair: config.pair,
            timeframe: config.timeframe,
            gapFillInserted: gapFillResult.totalInserted,
            gapFillSkipped: gapFillResult.totalSkipped,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Gap fill failed';
          incrementalResult.errors.push(`Gap fill failed: ${errorMessage}`);

          logger.warn('Gap fill failed, continuing with incremental update', {
            pair: config.pair,
            timeframe: config.timeframe,
            error: errorMessage,
          });
        }
      } else {
        logger.warn('Gap too large to fill automatically', {
          pair: config.pair,
          timeframe: config.timeframe,
          gapDays: Math.round(gapDays * 100) / 100,
          maxGapFillDays,
        });
      }
    }

    return incrementalResult;
  }

  /**
   * Gets the optimal lookback period for incremental updates based on timeframe
   */
  getRecommendedIncrementalLookback(timeframe: string): number {
    const lookbackHours: Record<string, number> = {
      '1m': 2, // 2 hours for 1-minute candles
      '5m': 6, // 6 hours for 5-minute candles
      '15m': 24, // 24 hours for 15-minute candles
      '30m': 48, // 48 hours for 30-minute candles
      '1h': 72, // 72 hours for 1-hour candles
      '4h': 168, // 1 week for 4-hour candles
      '1d': 720, // 30 days for daily candles
    };

    return lookbackHours[timeframe] || 24; // Default to 24 hours
  }

  /**
   * Gets the recommended batch size based on timeframe
   */
  getRecommendedBackfillBatchSize(timeframe: string): number {
    const batchSizes: Record<string, number> = {
      '1m': 1, // 1 day for 1-minute candles
      '5m': 3, // 3 days for 5-minute candles
      '15m': 7, // 7 days for 15-minute candles
      '30m': 14, // 14 days for 30-minute candles
      '1h': 30, // 30 days for 1-hour candles
      '4h': 90, // 90 days for 4-hour candles
      '1d': 365, // 365 days for daily candles
    };

    return batchSizes[timeframe] || 7; // Default to 7 days
  }

  /**
   * Interrupts the current ingestion process
   */
  interrupt(): void {
    this.isInterrupted = true;
    logger.info('Ingestion service interrupted');
  }

  /**
   * Resets the interruption flag
   */
  resetInterruption(): void {
    this.isInterrupted = false;
    logger.debug('Ingestion service interruption flag reset');
  }

  /**
   * Checks if the service is currently interrupted
   */
  isCurrentlyInterrupted(): boolean {
    return this.isInterrupted;
  }

  /**
   * Validates broker connection with error recovery
   */
  async validateBrokerConnection(): Promise<boolean> {
    const operationId = `validate_connection_${this.broker.getBrokerName()}_${Date.now()}`;
    
    const context: RecoveryContext = {
      operationId,
      operationType: 'validate_connection',
      attemptCount: 0,
      startTime: new Date(),
      metadata: {
        broker: this.broker.getBrokerName(),
      },
    };

    const operation = async () => {
      return await this.broker.validateConnection();
    };

    try {
      // First attempt without error recovery
      const isValid = await operation();
      logger.info('Broker connection validation result', {
        broker: this.broker.getBrokerName(),
        isValid,
      });
      return isValid;
    } catch (error) {
      const brokerError = error instanceof Error ? error : new Error('Unknown connection error');
      context.lastError = brokerError;
      
      logger.warn('Initial connection validation failed, initiating error recovery', {
        operationId,
        error: brokerError.message,
        broker: this.broker.getBrokerName(),
      });

      // Classify the error and execute recovery strategy
      const classification = errorRecoveryService.classifyError(brokerError);
      
      try {
        const { result, recoveryResult } = await errorRecoveryService.executeRecovery(
          context,
          operation,
          classification
        );

        logger.info('Connection validation recovery completed', {
          operationId,
          strategy: recoveryResult.strategy,
          isValid: result,
          totalTimeMs: recoveryResult.totalTimeMs,
        });

        return result;
      } catch (recoveryError) {
        logger.error('Broker connection validation failed after recovery', {
          operationId,
          broker: this.broker.getBrokerName(),
          originalError: brokerError.message,
          recoveryError: recoveryError instanceof Error ? recoveryError.message : 'Unknown error',
        });
        return false;
      }
    }
  }

  /**
   * Executes an operation with timeout handling for performance optimization
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();
    
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const elapsedTime = Date.now() - startTime;
        logger.error('Database operation timed out', {
          operationName,
          timeoutMs,
          elapsedTimeMs: elapsedTime,
          broker: this.broker.getBrokerName(),
        });
        reject(new Error(`Database operation '${operationName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          const elapsedTime = Date.now() - startTime;
          
          // Log slow operations for performance monitoring
          if (elapsedTime > timeoutMs * 0.8) {
            logger.warn('Slow database operation detected', {
              operationName,
              elapsedTimeMs: elapsedTime,
              timeoutMs,
              performanceThreshold: timeoutMs * 0.8,
            });
          }
          
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          const elapsedTime = Date.now() - startTime;
          
          logger.error('Database operation failed', {
            operationName,
            elapsedTimeMs: elapsedTime,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          
          reject(error);
        });
    });
  }
}
