#!/usr/bin/env tsx

import { Command } from 'commander';
import { CandleIngestionService, IngestionConfig } from '../services/candle-ingestion.service.js';
import { CandleNormalizer } from '../services/candle-normalizer.js';
import { createXauUsdTradingSessionFilter } from '../utils/trading-session.js';
import { CandleRepository } from '../repositories/candle.repository.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { PerformanceMonitor } from '../utils/performance-monitor.js';
import { LoadTester, LoadTestConfig } from '../utils/load-tester.js';
import { logger } from '../config/logger.js';

/**
 * Performance Optimization Script
 * 
 * Provides tools for optimizing and validating the performance of the
 * market data ingestion system. Includes batch size optimization,
 * memory usage analysis, and load testing capabilities.
 */

const program = new Command();

program
  .name('performance-optimizer')
  .description('Performance optimization and validation tools for market data ingestion')
  .version('1.0.0');

program
  .command('optimize-batch-size')
  .description('Find optimal batch size for ingestion operations')
  .option('--pair <pair>', 'Trading pair to test', 'XAU/USD')
  .option('--timeframe <timeframe>', 'Timeframe to test', '15m')
  .option('--hours <hours>', 'Hours of data to test with', '4')
  .option('--min-batch <size>', 'Minimum batch size to test', '10')
  .option('--max-batch <size>', 'Maximum batch size to test', '500')
  .option('--step <step>', 'Step size for batch testing', '25')
  .action(async (options) => {
    try {
      console.log('🔧 Optimizing batch size for ingestion operations...\n');

      const broker = BrokerFactory.createActiveBroker();
      const normalizer = new CandleNormalizer();
      const sessionFilter = createXauUsdTradingSessionFilter();
      const candleRepository = new CandleRepository();
      const performanceMonitor = new PerformanceMonitor();

      const ingestionService = new CandleIngestionService(
        broker,
        normalizer,
        sessionFilter,
        candleRepository
      );

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - parseInt(options.hours) * 60 * 60 * 1000);

      const results: Array<{
        batchSize: number;
        executionTime: number;
        memoryUsage: number;
        throughput: number;
        candlesProcessed: number;
      }> = [];

      const minBatch = parseInt(options.minBatch);
      const maxBatch = parseInt(options.maxBatch);
      const step = parseInt(options.step);

      for (let batchSize = minBatch; batchSize <= maxBatch; batchSize += step) {
        console.log(`Testing batch size: ${batchSize}`);

        const config: IngestionConfig = {
          pair: options.pair,
          timeframe: options.timeframe,
          enableSessionFiltering: false,
          batchSize,
          maxRetries: 3,
        };

        try {
          const { result, metrics } = await performanceMonitor.measureAsync(
            `batch-optimization-${batchSize}`,
            () => ingestionService.ingestCandles(config, startDate, endDate),
            { batchSize }
          );

          const throughput = result.totalInserted > 0 ? 
            (result.totalInserted / metrics.executionTime) * 1000 : 0;

          results.push({
            batchSize,
            executionTime: metrics.executionTime,
            memoryUsage: metrics.memoryUsage.heapUsed,
            throughput,
            candlesProcessed: result.totalInserted,
          });

          console.log(`  ✓ Batch ${batchSize}: ${Math.round(metrics.executionTime)}ms, ${metrics.memoryUsage.heapUsed}MB, ${throughput.toFixed(2)} candles/sec`);

          // Clean up test data
          await cleanupTestData(options.pair, options.timeframe);

        } catch (error) {
          console.log(`  ✗ Batch ${batchSize}: Failed - ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Analyze results
      if (results.length > 0) {
        console.log('\n📊 Batch Size Optimization Results:');
        console.log('┌─────────────┬──────────────┬─────────────┬─────────────────┬─────────────────┐');
        console.log('│ Batch Size  │ Time (ms)    │ Memory (MB) │ Throughput      │ Candles         │');
        console.log('├─────────────┼──────────────┼─────────────┼─────────────────┼─────────────────┤');

        results.forEach(result => {
          console.log(
            `│ ${result.batchSize.toString().padEnd(11)} │ ${Math.round(result.executionTime).toString().padEnd(12)} │ ${result.memoryUsage.toString().padEnd(11)} │ ${result.throughput.toFixed(2).padEnd(15)} │ ${result.candlesProcessed.toString().padEnd(15)} │`
          );
        });

        console.log('└─────────────┴──────────────┴─────────────┴─────────────────┴─────────────────┘');

        // Find optimal batch size (best throughput with reasonable memory usage)
        const optimalResult = results.reduce((best, current) => {
          if (current.memoryUsage > 256) return best; // Skip high memory usage
          return current.throughput > best.throughput ? current : best;
        });

        console.log(`\n🎯 Recommended optimal batch size: ${optimalResult.batchSize}`);
        console.log(`   - Throughput: ${optimalResult.throughput.toFixed(2)} candles/sec`);
        console.log(`   - Memory usage: ${optimalResult.memoryUsage}MB`);
        console.log(`   - Execution time: ${Math.round(optimalResult.executionTime)}ms`);
      } else {
        console.log('❌ No successful batch size tests completed');
      }

    } catch (error) {
      console.error('❌ Batch size optimization failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('memory-analysis')
  .description('Analyze memory usage patterns during ingestion')
  .option('--pair <pair>', 'Trading pair to test', 'XAU/USD')
  .option('--timeframe <timeframe>', 'Timeframe to test', '15m')
  .option('--days <days>', 'Days of data to test with', '7')
  .option('--batch-size <size>', 'Batch size to use', '100')
  .action(async (options) => {
    try {
      console.log('🧠 Analyzing memory usage patterns...\n');

      const broker = BrokerFactory.createActiveBroker();
      const normalizer = new CandleNormalizer();
      const sessionFilter = createXauUsdTradingSessionFilter();
      const candleRepository = new CandleRepository();
      const performanceMonitor = new PerformanceMonitor();
      const loadTester = new LoadTester(
        new CandleIngestionService(broker, normalizer, sessionFilter, candleRepository),
        performanceMonitor
      );

      const config: IngestionConfig = {
        pair: options.pair,
        timeframe: options.timeframe,
        enableSessionFiltering: false,
        batchSize: parseInt(options.batchSize),
        maxRetries: 3,
      };

      const memoryLimits = {
        maxHeapUsedMB: 512,
        maxRssMB: 1024,
      };

      console.log(`Testing memory usage with ${options.days} days of data...`);

      const memoryResult = await loadTester.testLargeBackfillMemory(
        config,
        parseInt(options.days),
        memoryLimits
      );

      console.log('\n📊 Memory Analysis Results:');
      console.log(`✓ Success: ${memoryResult.success ? 'Yes' : 'No'}`);
      console.log(`📈 Peak memory usage: ${memoryResult.peakMemoryUsage}MB`);
      console.log(`⏱️  Processing time: ${Math.round(memoryResult.processingTimeMs)}ms`);
      console.log(`📊 Candles processed: ${memoryResult.candlesProcessed}`);

      if (memoryResult.memoryViolations.length > 0) {
        console.log('\n⚠️  Memory violations detected:');
        memoryResult.memoryViolations.forEach((violation, index) => {
          console.log(`   ${index + 1}. ${violation}`);
        });
      } else {
        console.log('\n✅ No memory violations detected');
      }

      // Current memory usage
      const currentMemory = performanceMonitor.getCurrentMemoryUsage();
      console.log('\n💾 Current memory usage:');
      console.log(`   Heap used: ${Math.round(currentMemory.heapUsed / 1024 / 1024)}MB`);
      console.log(`   Heap total: ${Math.round(currentMemory.heapTotal / 1024 / 1024)}MB`);
      console.log(`   RSS: ${Math.round(currentMemory.rss / 1024 / 1024)}MB`);
      console.log(`   External: ${Math.round(currentMemory.external / 1024 / 1024)}MB`);

    } catch (error) {
      console.error('❌ Memory analysis failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('load-test')
  .description('Run comprehensive load tests')
  .option('--concurrent <count>', 'Number of concurrent operations', '3')
  .option('--duration <ms>', 'Test duration in milliseconds', '30000')
  .option('--volume-multiplier <multiplier>', 'Data volume multiplier', '1')
  .option('--memory-limit <mb>', 'Memory limit in MB', '512')
  .action(async (options) => {
    try {
      console.log('🚀 Running comprehensive load tests...\n');

      const broker = BrokerFactory.createActiveBroker();
      const normalizer = new CandleNormalizer();
      const sessionFilter = createXauUsdTradingSessionFilter();
      const candleRepository = new CandleRepository();
      const performanceMonitor = new PerformanceMonitor();

      const ingestionService = new CandleIngestionService(
        broker,
        normalizer,
        sessionFilter,
        candleRepository
      );

      const loadTester = new LoadTester(ingestionService, performanceMonitor);

      const loadTestConfig: LoadTestConfig = {
        concurrentOperations: parseInt(options.concurrent),
        dataVolumeMultiplier: parseFloat(options.volumeMultiplier),
        testDurationMs: parseInt(options.duration),
        memoryLimits: {
          maxHeapUsedMB: parseInt(options.memoryLimit),
          maxRssMB: parseInt(options.memoryLimit) * 2,
        },
        performanceThresholds: {
          maxExecutionTimeMs: 20000,
          minThroughputCandlesPerSecond: 1,
        },
      };

      const ingestionConfig: IngestionConfig = {
        pair: 'XAU/USD',
        timeframe: '15m',
        enableSessionFiltering: false,
        batchSize: 100,
        maxRetries: 3,
      };

      console.log(`Running load test with ${options.concurrent} concurrent operations for ${options.duration}ms...`);

      const loadTestResult = await loadTester.runLoadTest(
        loadTestConfig,
        ingestionConfig
      );

      console.log('\n📊 Load Test Results:');
      console.log(`✓ Success: ${loadTestResult.success ? 'Yes' : 'No'}`);
      console.log(`📈 Total operations: ${loadTestResult.totalOperations}`);
      console.log(`✅ Successful operations: ${loadTestResult.successfulOperations}`);
      console.log(`❌ Failed operations: ${loadTestResult.failedOperations}`);
      console.log(`⏱️  Average execution time: ${Math.round(loadTestResult.averageExecutionTime)}ms`);
      console.log(`💾 Peak memory usage: ${loadTestResult.peakMemoryUsage}MB`);
      console.log(`🚀 Throughput: ${loadTestResult.throughput.operationsPerSecond.toFixed(2)} ops/sec`);

      if (loadTestResult.memoryViolations.length > 0) {
        console.log('\n⚠️  Memory violations:');
        loadTestResult.memoryViolations.forEach((violation, index) => {
          console.log(`   ${index + 1}. ${violation}`);
        });
      }

      if (loadTestResult.performanceViolations.length > 0) {
        console.log('\n⚠️  Performance violations:');
        loadTestResult.performanceViolations.forEach((violation, index) => {
          console.log(`   ${index + 1}. ${violation}`);
        });
      }

      if (loadTestResult.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        loadTestResult.errors.slice(0, 5).forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
        if (loadTestResult.errors.length > 5) {
          console.log(`   ... and ${loadTestResult.errors.length - 5} more errors`);
        }
      }

    } catch (error) {
      console.error('❌ Load test failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('database-performance')
  .description('Test database query performance')
  .option('--queries <count>', 'Number of queries to test', '100')
  .option('--concurrent <count>', 'Number of concurrent queries', '10')
  .action(async (options) => {
    try {
      console.log('🗄️  Testing database performance...\n');

      const broker = BrokerFactory.createActiveBroker();
      const normalizer = new CandleNormalizer();
      const sessionFilter = createXauUsdTradingSessionFilter();
      const candleRepository = new CandleRepository();
      const performanceMonitor = new PerformanceMonitor();

      const ingestionService = new CandleIngestionService(
        broker,
        normalizer,
        sessionFilter,
        candleRepository
      );

      const loadTester = new LoadTester(ingestionService, performanceMonitor);

      const config: IngestionConfig = {
        pair: 'XAU/USD',
        timeframe: '15m',
        enableSessionFiltering: false,
        batchSize: 100,
        maxRetries: 3,
      };

      console.log(`Testing ${options.queries} queries with ${options.concurrent} concurrent operations...`);

      const dbResult = await loadTester.testDatabasePerformance(
        config,
        parseInt(options.queries),
        parseInt(options.concurrent)
      );

      console.log('\n📊 Database Performance Results:');
      console.log(`✓ Success: ${dbResult.success ? 'Yes' : 'No'}`);
      console.log(`⏱️  Average query time: ${Math.round(dbResult.averageQueryTime)}ms`);
      console.log(`📈 Max query time: ${Math.round(dbResult.maxQueryTime)}ms`);
      console.log(`📉 Min query time: ${Math.round(dbResult.minQueryTime)}ms`);
      console.log(`❌ Failed queries: ${dbResult.failedQueries}`);
      console.log(`🚀 Throughput: ${dbResult.throughputQueriesPerSecond.toFixed(2)} queries/sec`);

      // Performance recommendations
      console.log('\n💡 Performance Recommendations:');
      if (dbResult.averageQueryTime > 500) {
        console.log('   ⚠️  Average query time is high (>500ms). Consider optimizing database indexes.');
      }
      if (dbResult.throughputQueriesPerSecond < 10) {
        console.log('   ⚠️  Query throughput is low (<10 queries/sec). Consider connection pooling optimization.');
      }
      if (dbResult.failedQueries > 0) {
        console.log('   ❌ Some queries failed. Check database connection stability.');
      }
      if (dbResult.averageQueryTime < 100 && dbResult.throughputQueriesPerSecond > 20) {
        console.log('   ✅ Database performance is excellent!');
      }

    } catch (error) {
      console.error('❌ Database performance test failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

async function cleanupTestData(pair: string, timeframe: string): Promise<void> {
  try {
    const candleRepository = new CandleRepository();
    // Note: This is a simplified cleanup - in a real implementation,
    // you might want to use a more targeted cleanup approach
    logger.debug('Cleaning up test data', { pair, timeframe });
  } catch (error) {
    logger.warn('Failed to cleanup test data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

program.parse();