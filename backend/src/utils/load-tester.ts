import { CandleIngestionService, IngestionConfig } from '../services/candle-ingestion.service.js';
import { PerformanceMonitor, PerformanceMetrics } from './performance-monitor.js';
import { logger } from '../config/logger.js';

/**
 * Load Testing Utility
 * 
 * Provides comprehensive load testing capabilities for the ingestion system,
 * including concurrent operations, large data volume testing, and
 * performance validation under various conditions.
 */

export interface LoadTestConfig {
  concurrentOperations: number;
  dataVolumeMultiplier: number;
  testDurationMs: number;
  memoryLimits: {
    maxHeapUsedMB: number;
    maxRssMB: number;
  };
  performanceThresholds: {
    maxExecutionTimeMs: number;
    minThroughputCandlesPerSecond: number;
  };
}

export interface LoadTestResult {
  success: boolean;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageExecutionTime: number;
  peakMemoryUsage: number;
  throughput: {
    candlesPerSecond: number;
    operationsPerSecond: number;
  };
  memoryViolations: string[];
  performanceViolations: string[];
  errors: string[];
  detailedMetrics: PerformanceMetrics[];
}

export class LoadTester {
  private performanceMonitor: PerformanceMonitor;
  private ingestionService: CandleIngestionService;

  constructor(
    ingestionService: CandleIngestionService,
    performanceMonitor?: PerformanceMonitor
  ) {
    this.ingestionService = ingestionService;
    this.performanceMonitor = performanceMonitor || new PerformanceMonitor();
  }

  /**
   * Runs a comprehensive load test
   */
  async runLoadTest(
    config: LoadTestConfig,
    ingestionConfig: IngestionConfig
  ): Promise<LoadTestResult> {
    logger.info('Starting load test', {
      concurrentOperations: config.concurrentOperations,
      dataVolumeMultiplier: config.dataVolumeMultiplier,
      testDurationMs: config.testDurationMs,
      memoryLimits: config.memoryLimits,
      performanceThresholds: config.performanceThresholds,
    });

    const result: LoadTestResult = {
      success: false,
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageExecutionTime: 0,
      peakMemoryUsage: 0,
      throughput: {
        candlesPerSecond: 0,
        operationsPerSecond: 0,
      },
      memoryViolations: [],
      performanceViolations: [],
      errors: [],
      detailedMetrics: [],
    };

    const startTime = Date.now();
    const operations: Promise<void>[] = [];

    try {
      // Start concurrent operations
      for (let i = 0; i < config.concurrentOperations; i++) {
        const operation = this.runSingleOperation(
          ingestionConfig,
          config.dataVolumeMultiplier,
          i
        );
        operations.push(operation);
      }

      // Monitor memory usage during test
      const memoryMonitor = setInterval(() => {
        const memoryCheck = this.performanceMonitor.checkMemoryLimits(
          config.memoryLimits
        );
        
        if (!memoryCheck.withinLimits) {
          result.memoryViolations.push(...memoryCheck.violations);
          logger.warn('Memory limit violation detected during load test', {
            violations: memoryCheck.violations,
            currentUsage: this.performanceMonitor.formatMemoryUsage(
              memoryCheck.currentUsage
            ),
          });
        }
      }, 1000); // Check every second

      // Wait for all operations to complete or timeout
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Load test timeout after ${config.testDurationMs}ms`));
        }, config.testDurationMs);
      });

      try {
        await Promise.race([
          Promise.allSettled(operations),
          timeoutPromise,
        ]);
      } catch (error) {
        result.errors.push(
          error instanceof Error ? error.message : 'Load test timeout'
        );
      }

      clearInterval(memoryMonitor);

      // Analyze results
      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      result.totalOperations = operations.length;
      
      // Count successful and failed operations
      const settledResults = await Promise.allSettled(operations);
      result.successfulOperations = settledResults.filter(
        r => r.status === 'fulfilled'
      ).length;
      result.failedOperations = settledResults.filter(
        r => r.status === 'rejected'
      ).length;

      // Add errors from failed operations
      settledResults.forEach((settledResult, index) => {
        if (settledResult.status === 'rejected') {
          result.errors.push(
            `Operation ${index}: ${settledResult.reason?.message || 'Unknown error'}`
          );
        }
      });

      // Calculate performance metrics
      const stats = this.performanceMonitor.getPerformanceStats();
      result.averageExecutionTime = stats.averageExecutionTime;
      result.peakMemoryUsage = stats.peakMemoryUsage;
      
      result.throughput.operationsPerSecond = 
        (result.successfulOperations / totalDuration) * 1000;

      // Check performance thresholds
      if (result.averageExecutionTime > config.performanceThresholds.maxExecutionTimeMs) {
        result.performanceViolations.push(
          `Average execution time ${Math.round(result.averageExecutionTime)}ms exceeds threshold ${config.performanceThresholds.maxExecutionTimeMs}ms`
        );
      }

      if (result.throughput.operationsPerSecond < config.performanceThresholds.minThroughputCandlesPerSecond) {
        result.performanceViolations.push(
          `Throughput ${result.throughput.operationsPerSecond.toFixed(2)} ops/sec below threshold ${config.performanceThresholds.minThroughputCandlesPerSecond} ops/sec`
        );
      }

      // Determine overall success
      result.success = 
        result.failedOperations === 0 &&
        result.memoryViolations.length === 0 &&
        result.performanceViolations.length === 0;

      logger.info('Load test completed', {
        success: result.success,
        totalOperations: result.totalOperations,
        successfulOperations: result.successfulOperations,
        failedOperations: result.failedOperations,
        averageExecutionTime: Math.round(result.averageExecutionTime),
        peakMemoryUsage: result.peakMemoryUsage,
        throughput: result.throughput,
        memoryViolations: result.memoryViolations.length,
        performanceViolations: result.performanceViolations.length,
        errors: result.errors.length,
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown load test error';
      result.errors.push(errorMessage);
      
      logger.error('Load test failed', {
        error: errorMessage,
        totalOperations: result.totalOperations,
        successfulOperations: result.successfulOperations,
      });

      return result;
    }
  }

  /**
   * Runs a single operation for load testing
   */
  private async runSingleOperation(
    config: IngestionConfig,
    dataVolumeMultiplier: number,
    operationIndex: number
  ): Promise<void> {
    const benchmarkId = this.performanceMonitor.startBenchmark(
      `load-test-operation-${operationIndex}`,
      {
        operationIndex,
        dataVolumeMultiplier,
        config,
      }
    );

    try {
      // Generate test date range based on volume multiplier
      const baseHours = 2; // Base 2 hours of data
      const totalHours = baseHours * dataVolumeMultiplier;
      
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - totalHours * 60 * 60 * 1000);

      // Perform ingestion
      const result = await this.ingestionService.ingestCandles(
        config,
        startDate,
        endDate
      );

      // Update throughput metrics
      const metrics = this.performanceMonitor.endBenchmark(benchmarkId);
      if (metrics && result.processingTimeMs > 0) {
        metrics.throughput.candlesPerSecond = 
          (result.totalInserted / result.processingTimeMs) * 1000;
        metrics.throughput.batchesPerSecond = 
          (1 / result.processingTimeMs) * 1000;
      }

      logger.debug('Load test operation completed', {
        operationIndex,
        totalFetched: result.totalFetched,
        totalInserted: result.totalInserted,
        processingTimeMs: result.processingTimeMs,
      });

    } catch (error) {
      this.performanceMonitor.endBenchmark(benchmarkId);
      throw error;
    }
  }

  /**
   * Tests memory usage during large backfill operations
   */
  async testLargeBackfillMemory(
    config: IngestionConfig,
    dateRangeDays: number,
    memoryLimits: {
      maxHeapUsedMB: number;
      maxRssMB: number;
    }
  ): Promise<{
    success: boolean;
    peakMemoryUsage: number;
    memoryViolations: string[];
    processingTimeMs: number;
    candlesProcessed: number;
  }> {
    logger.info('Starting large backfill memory test', {
      dateRangeDays,
      memoryLimits,
    });

    const result = {
      success: false,
      peakMemoryUsage: 0,
      memoryViolations: [] as string[],
      processingTimeMs: 0,
      candlesProcessed: 0,
    };

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - dateRangeDays * 24 * 60 * 60 * 1000);

    // Monitor memory usage throughout the operation
    let peakMemoryUsage = 0;
    const memoryViolations: string[] = [];

    const memoryMonitor = setInterval(() => {
      const memoryCheck = this.performanceMonitor.checkMemoryLimits(memoryLimits);
      const currentHeapUsage = Math.round(
        memoryCheck.currentUsage.heapUsed / 1024 / 1024
      );
      
      peakMemoryUsage = Math.max(peakMemoryUsage, currentHeapUsage);
      
      if (!memoryCheck.withinLimits) {
        memoryViolations.push(...memoryCheck.violations);
      }
    }, 500); // Check every 500ms for more granular monitoring

    try {
      const { result: backfillResult, metrics } = await this.performanceMonitor.measureAsync(
        'large-backfill-memory-test',
        () => this.ingestionService.backfillHistoricalData(
          config,
          startDate,
          endDate,
          Math.max(1, Math.floor(dateRangeDays / 7)) // Reasonable batch size
        ),
        { dateRangeDays, memoryLimits }
      );

      clearInterval(memoryMonitor);

      result.peakMemoryUsage = Math.max(peakMemoryUsage, metrics.memoryUsage.heapUsed);
      result.memoryViolations = [...new Set(memoryViolations)]; // Remove duplicates
      result.processingTimeMs = metrics.executionTime;
      result.candlesProcessed = backfillResult.totalInserted;
      result.success = result.memoryViolations.length === 0;

      logger.info('Large backfill memory test completed', {
        success: result.success,
        peakMemoryUsage: result.peakMemoryUsage,
        memoryViolations: result.memoryViolations.length,
        processingTimeMs: Math.round(result.processingTimeMs),
        candlesProcessed: result.candlesProcessed,
      });

      return result;

    } catch (error) {
      clearInterval(memoryMonitor);
      throw error;
    }
  }

  /**
   * Tests database query performance under load
   */
  async testDatabasePerformance(
    config: IngestionConfig,
    queryCount: number,
    concurrentQueries: number
  ): Promise<{
    success: boolean;
    averageQueryTime: number;
    maxQueryTime: number;
    minQueryTime: number;
    failedQueries: number;
    throughputQueriesPerSecond: number;
  }> {
    logger.info('Starting database performance test', {
      queryCount,
      concurrentQueries,
    });

    const queryTimes: number[] = [];
    const errors: string[] = [];
    const startTime = Date.now();

    // Create batches of concurrent queries
    const batchSize = concurrentQueries;
    const batches = Math.ceil(queryCount / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const batchQueries: Promise<number>[] = [];
      const queriesInThisBatch = Math.min(batchSize, queryCount - batch * batchSize);

      for (let i = 0; i < queriesInThisBatch; i++) {
        const queryPromise = this.performSingleDatabaseQuery(config);
        batchQueries.push(queryPromise);
      }

      const batchResults = await Promise.allSettled(batchQueries);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          queryTimes.push(result.value);
        } else {
          errors.push(`Batch ${batch}, Query ${index}: ${result.reason?.message || 'Unknown error'}`);
        }
      });
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    const result = {
      success: errors.length === 0,
      averageQueryTime: queryTimes.length > 0 ? 
        queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length : 0,
      maxQueryTime: queryTimes.length > 0 ? Math.max(...queryTimes) : 0,
      minQueryTime: queryTimes.length > 0 ? Math.min(...queryTimes) : 0,
      failedQueries: errors.length,
      throughputQueriesPerSecond: (queryTimes.length / totalDuration) * 1000,
    };

    logger.info('Database performance test completed', {
      success: result.success,
      averageQueryTime: Math.round(result.averageQueryTime),
      maxQueryTime: Math.round(result.maxQueryTime),
      minQueryTime: Math.round(result.minQueryTime),
      failedQueries: result.failedQueries,
      throughputQueriesPerSecond: result.throughputQueriesPerSecond.toFixed(2),
    });

    return result;
  }

  /**
   * Performs a single database query for performance testing
   */
  private async performSingleDatabaseQuery(config: IngestionConfig): Promise<number> {
    const startTime = performance.now();
    
    try {
      // Use a simple repository query instead of full incremental update
      // This tests actual database query performance without the overhead of ingestion
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 4 * 60 * 60 * 1000); // Last 4 hours
      
      // Access the repository through the ingestion service to test query performance
      const service = this.ingestionService as any;
      if (service.candleRepository && service.candleRepository.getCandlesByDateRange) {
        await service.candleRepository.getCandlesByDateRange(
          config.pair,
          config.timeframe,
          startDate,
          endDate
        );
      } else {
        // Fallback to a lightweight incremental update
        await this.ingestionService.updateIncremental(config, 1);
      }
      
      return performance.now() - startTime;
    } catch (error) {
      throw new Error(`Database query failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}