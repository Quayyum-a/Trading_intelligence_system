#!/usr/bin/env node

import { Command } from 'commander';
import { CandleRepository } from '../repositories/candle.repository.js';
import { DataVerificationService } from '../services/data-verification.service.js';
import { IngestionManagementService } from '../services/ingestion-management.service.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();
const program = new Command();

/**
 * Debugging and troubleshooting tools for the ingestion system
 * Requirements: 6.1, 7.1, 7.2, 7.3, 7.4, 7.5
 */

program
  .name('debug-tools')
  .description('Debugging and troubleshooting tools for market data ingestion')
  .version('1.0.0');

// Broker debug command
program
  .command('broker')
  .description('Debug broker connections and API responses')
  .requiredOption('-b, --broker <name>', 'Broker name to debug')
  .option('-p, --pair <pair>', 'Test with specific pair', 'XAU/USD')
  .option('-t, --timeframe <timeframe>', 'Test with specific timeframe', '15m')
  .option('--test-fetch', 'Test candle fetching')
  .option('--verbose', 'Enable verbose output')
  .action(async options => {
    try {
      console.log(`🔍 Debugging broker: ${options.broker}`);
      console.log(`Pair: ${options.pair}, Timeframe: ${options.timeframe}`);

      const broker = BrokerFactory.createBroker(options.broker);

      // Test connection
      console.log('\n🔌 Testing broker connection...');
      const startTime = Date.now();
      const isConnected = await broker.validateConnection();
      const connectionTime = Date.now() - startTime;

      if (isConnected) {
        console.log(`✅ Connection successful (${connectionTime}ms)`);
      } else {
        console.log(`❌ Connection failed (${connectionTime}ms)`);
        return;
      }

      // Test candle fetching if requested
      if (options.testFetch) {
        console.log('\n📊 Testing candle fetching...');

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        try {
          const fetchStartTime = Date.now();
          const candles = await broker.fetchCandles(
            options.pair,
            options.timeframe,
            startDate,
            endDate
          );
          const fetchTime = Date.now() - fetchStartTime;

          console.log(`✅ Fetched ${candles.length} candles (${fetchTime}ms)`);

          if (candles.length > 0) {
            const firstCandle = candles[0];
            const lastCandle = candles[candles.length - 1];

            console.log('\n📈 Sample candles:');
            console.log(
              `First: ${firstCandle.timestamp} - O:${firstCandle.open} H:${firstCandle.high} L:${firstCandle.low} C:${firstCandle.close} V:${firstCandle.volume || 'N/A'}`
            );
            console.log(
              `Last:  ${lastCandle.timestamp} - O:${lastCandle.open} H:${lastCandle.high} L:${lastCandle.low} C:${lastCandle.close} V:${lastCandle.volume || 'N/A'}`
            );

            // Validate candle data
            console.log('\n🔍 Validating candle data...');
            let validCandles = 0;
            let invalidCandles = 0;

            for (const candle of candles) {
              const isValid =
                candle.high >= candle.low &&
                candle.high >= candle.open &&
                candle.high >= candle.close &&
                candle.low <= candle.open &&
                candle.low <= candle.close &&
                candle.open > 0 &&
                candle.high > 0 &&
                candle.low > 0 &&
                candle.close > 0;

              if (isValid) {
                validCandles++;
              } else {
                invalidCandles++;
                if (options.verbose) {
                  console.log(
                    `   ❌ Invalid candle at ${candle.timestamp}: O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`
                  );
                }
              }
            }

            console.log(`✅ Valid candles: ${validCandles}`);
            console.log(`❌ Invalid candles: ${invalidCandles}`);

            // Check for gaps in timestamps
            console.log('\n🕳️  Checking for timestamp gaps...');
            let gaps = 0;
            const timeframeMs = parseTimeframeToMs(options.timeframe);

            for (let i = 0; i < candles.length - 1; i++) {
              const current = new Date(candles[i].timestamp);
              const next = new Date(candles[i + 1].timestamp);
              const expectedNext = new Date(current.getTime() + timeframeMs);

              if (
                Math.abs(next.getTime() - expectedNext.getTime()) >
                timeframeMs / 2
              ) {
                gaps++;
                if (options.verbose) {
                  console.log(
                    `   🕳️  Gap between ${current.toISOString()} and ${next.toISOString()}`
                  );
                }
              }
            }

            console.log(`🕳️  Timestamp gaps found: ${gaps}`);
          }
        } catch (error) {
          console.log(
            `❌ Fetch failed: ${error instanceof Error ? error.message : error}`
          );

          if (options.verbose && error instanceof Error && error.stack) {
            console.log('\nStack trace:');
            console.log(error.stack);
          }
        }
      }
    } catch (error) {
      console.error(
        `❌ Broker debug failed: ${error instanceof Error ? error.message : error}`
      );

      if (options.verbose && error instanceof Error && error.stack) {
        console.log('\nStack trace:');
        console.log(error.stack);
      }

      process.exit(1);
    }
  });

// Database debug command
program
  .command('database')
  .description('Debug database operations and data integrity')
  .option('-p, --pair <pair>', 'Focus on specific pair', 'XAU/USD')
  .option('-t, --timeframe <timeframe>', 'Focus on specific timeframe', '15m')
  .option('--check-schema', 'Check database schema')
  .option('--analyze-data', 'Analyze stored data')
  .option('--verbose', 'Enable verbose output')
  .action(async options => {
    try {
      console.log('🗄️  Debugging database operations...');

      const candleRepository = new CandleRepository();
      const verificationService = new DataVerificationService(candleRepository);

      if (options.checkSchema) {
        console.log('\n📋 Checking database schema...');

        try {
          // Test basic operations
          const count = await candleRepository.getCandleCount(
            options.pair,
            options.timeframe
          );
          console.log(`✅ Basic query successful - ${count} candles found`);

          // Test date range query
          const endDate = new Date();
          const startDate = new Date(
            endDate.getTime() - 7 * 24 * 60 * 60 * 1000
          );
          const recentCandles = await candleRepository.getCandlesByDateRange(
            options.pair,
            options.timeframe,
            startDate,
            endDate,
            10
          );
          console.log(
            `✅ Date range query successful - ${recentCandles.length} recent candles`
          );

          // Test latest timestamp query
          const latestTimestamp =
            await candleRepository.getLatestCandleTimestamp(
              options.pair,
              options.timeframe
            );
          console.log(
            `✅ Latest timestamp query successful - ${latestTimestamp?.toISOString() || 'No data'}`
          );
        } catch (error) {
          console.log(
            `❌ Schema check failed: ${error instanceof Error ? error.message : error}`
          );
        }
      }

      if (options.analyzeData) {
        console.log('\n📊 Analyzing stored data...');

        try {
          // Get data statistics
          const totalCount = await candleRepository.getCandleCount(
            options.pair,
            options.timeframe
          );
          console.log(`Total candles: ${totalCount.toLocaleString()}`);

          if (totalCount > 0) {
            // Get recent data for analysis
            const endDate = new Date();
            const startDate = new Date(
              endDate.getTime() - 30 * 24 * 60 * 60 * 1000
            ); // 30 days

            console.log('\n🔍 Analyzing recent data (last 30 days)...');

            // Check for gaps
            const gaps = await verificationService.checkForGaps(
              options.pair,
              options.timeframe,
              startDate,
              endDate
            );
            console.log(`Timestamp gaps: ${gaps.length}`);

            if (gaps.length > 0 && options.verbose) {
              console.log('Recent gaps:');
              gaps.slice(0, 5).forEach((gap, index) => {
                console.log(
                  `  ${index + 1}. ${gap.gapDurationMinutes}min gap at ${gap.expectedTimestamp.toISOString()}`
                );
              });
            }

            // Check for duplicates
            const duplicates = await verificationService.detectDuplicates(
              options.pair,
              options.timeframe
            );
            console.log(`Duplicate candles: ${duplicates.length}`);

            if (duplicates.length > 0 && options.verbose) {
              console.log('Recent duplicates:');
              duplicates.slice(0, 5).forEach((dup, index) => {
                console.log(
                  `  ${index + 1}. ${dup.timestamp.toISOString()} (${dup.duplicateCount} copies)`
                );
              });
            }

            // Check OHLC integrity
            const validation = await verificationService.validateOHLCIntegrity(
              options.pair,
              options.timeframe
            );
            console.log(
              `OHLC validation: ${validation.validCandles} valid, ${validation.invalidCandles} invalid`
            );

            if (validation.errors.length > 0 && options.verbose) {
              console.log('OHLC errors:');
              validation.errors.slice(0, 5).forEach((error, index) => {
                console.log(
                  `  ${index + 1}. ${error.errorType}: ${error.errorMessage}`
                );
              });
            }

            // Check volume consistency
            const volumeCheck =
              await verificationService.validateVolumeConsistency(
                options.pair,
                options.timeframe
              );
            console.log(
              `Volume consistency: ${volumeCheck.isConsistent ? 'Good' : 'Issues found'}`
            );
            console.log(
              `Volume stats: ${volumeCheck.candlesWithVolume} with volume, ${volumeCheck.candlesWithoutVolume} without`
            );
            console.log(
              `Average volume: ${volumeCheck.averageVolume.toFixed(2)}`
            );

            // Data freshness check
            const latestTimestamp =
              await candleRepository.getLatestCandleTimestamp(
                options.pair,
                options.timeframe
              );

            if (latestTimestamp) {
              const timeSinceLatest = Date.now() - latestTimestamp.getTime();
              const hoursSinceLatest = Math.floor(
                timeSinceLatest / (1000 * 60 * 60)
              );

              console.log(
                `Data freshness: Latest candle is ${hoursSinceLatest}h old`
              );

              if (hoursSinceLatest > 24) {
                console.log('⚠️  Data may be stale (>24h old)');
              } else {
                console.log('✅ Data is relatively fresh');
              }
            }
          }
        } catch (error) {
          console.log(
            `❌ Data analysis failed: ${error instanceof Error ? error.message : error}`
          );

          if (options.verbose && error instanceof Error && error.stack) {
            console.log('\nStack trace:');
            console.log(error.stack);
          }
        }
      }
    } catch (error) {
      console.error(
        `❌ Database debug failed: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  });

// System debug command
program
  .command('system')
  .description('Debug system performance and resource usage')
  .option('--memory', 'Analyze memory usage')
  .option('--performance', 'Check performance metrics')
  .option('--jobs', 'Debug job system')
  .option('--verbose', 'Enable verbose output')
  .action(async options => {
    try {
      console.log('💻 Debugging system performance...');

      if (options.memory) {
        console.log('\n🧠 Memory Analysis:');

        const memoryUsage = process.memoryUsage();

        console.log(
          `Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
        );
        console.log(
          `Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
        );
        console.log(
          `External: ${Math.round(memoryUsage.external / 1024 / 1024)}MB`
        );
        console.log(`RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB`);

        // Memory usage recommendations
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        if (heapUsedMB > 1024) {
          console.log('⚠️  High memory usage detected (>1GB)');
          console.log(
            '   Consider reducing batch sizes or implementing memory cleanup'
          );
        } else if (heapUsedMB > 512) {
          console.log('⚠️  Moderate memory usage (>512MB)');
          console.log(
            '   Monitor for memory leaks during long-running operations'
          );
        } else {
          console.log('✅ Memory usage is within normal range');
        }

        // Force garbage collection if available (development only)
        if (global.gc && options.verbose) {
          console.log('\n🗑️  Running garbage collection...');
          const beforeGC = process.memoryUsage().heapUsed;
          global.gc();
          const afterGC = process.memoryUsage().heapUsed;
          const freed = Math.round((beforeGC - afterGC) / 1024 / 1024);
          console.log(`Freed ${freed}MB of memory`);
        }
      }

      if (options.performance) {
        console.log('\n⚡ Performance Metrics:');

        const uptime = process.uptime();
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);

        console.log(`Process uptime: ${uptimeHours}h ${uptimeMinutes}m`);
        console.log(`Node.js version: ${process.version}`);
        console.log(`Platform: ${process.platform} ${process.arch}`);

        // CPU usage (simplified)
        const cpuUsage = process.cpuUsage();
        console.log(
          `CPU usage: User ${Math.round(cpuUsage.user / 1000)}ms, System ${Math.round(cpuUsage.system / 1000)}ms`
        );

        // Event loop lag check (simplified)
        const start = process.hrtime.bigint();
        setImmediate(() => {
          const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
          console.log(`Event loop lag: ${lag.toFixed(2)}ms`);

          if (lag > 100) {
            console.log('⚠️  High event loop lag detected');
            console.log(
              '   Consider reducing synchronous operations or batch sizes'
            );
          } else {
            console.log('✅ Event loop lag is acceptable');
          }
        });
      }

      if (options.jobs) {
        console.log('\n📋 Job System Debug:');

        try {
          const managementService = new IngestionManagementService();

          // Get job statistics
          const stats = managementService.getIngestionStats();
          const queueStatus = managementService.getQueueStatus();

          console.log(`Total jobs: ${stats.totalJobs}`);
          console.log(`Running jobs: ${stats.runningJobs}`);
          console.log(`Completed jobs: ${stats.completedJobs}`);
          console.log(`Failed jobs: ${stats.failedJobs}`);
          console.log(
            `Queue status: ${queueStatus.pendingJobs} pending, ${queueStatus.runningJobs}/${queueStatus.maxConcurrentJobs} running`
          );
          console.log(`System health: ${stats.systemHealth}`);

          if (options.verbose) {
            // Show recent jobs
            const recentJobs = managementService.listJobs({ limit: 5 });

            if (recentJobs.length > 0) {
              console.log('\nRecent jobs:');
              recentJobs.forEach(job => {
                const duration =
                  job.completedAt && job.startedAt
                    ? Math.round(
                        (job.completedAt.getTime() - job.startedAt.getTime()) /
                          1000
                      )
                    : 'N/A';

                console.log(
                  `  ${job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '⏳'} ${job.id}`
                );
                console.log(
                  `     ${job.pair} ${job.timeframe} (${job.mode}) - ${duration}s`
                );

                if (job.result) {
                  console.log(
                    `     Result: ${job.result.totalInserted} inserted, ${job.result.errors.length} errors`
                  );
                }
              });
            }

            // Show active alerts
            const alerts = managementService.getActiveAlerts();
            if (alerts.length > 0) {
              console.log(`\nActive alerts: ${alerts.length}`);
              alerts.slice(0, 3).forEach(alert => {
                console.log(
                  `  ${alert.severity === 'critical' ? '🔴' : alert.severity === 'high' ? '🟠' : '🟡'} ${alert.type}: ${alert.message}`
                );
              });
            }
          }
        } catch (error) {
          console.log(
            `❌ Job system debug failed: ${error instanceof Error ? error.message : error}`
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ System debug failed: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  });

// Utility function to parse timeframe to milliseconds
function parseTimeframeToMs(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhd])$/i);
  if (!match) return 15 * 60 * 1000; // Default to 15 minutes

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

// Parse command line arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };
