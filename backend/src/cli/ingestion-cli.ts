#!/usr/bin/env node

import { Command } from 'commander';
import {
  CandleIngestionService,
  IngestionConfig,
} from '../services/candle-ingestion.service.js';
import { IngestionManagementService } from '../services/ingestion-management.service.js';
import { DataVerificationService } from '../services/data-verification.service.js';
import { CandleRepository } from '../repositories/candle.repository.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();
const program = new Command();

/**
 * CLI tool for manual ingestion operations
 * Requirements: 6.1, 7.1, 7.2, 7.3, 7.4, 7.5
 */

program
  .name('ingestion-cli')
  .description('Market Data Ingestion CLI Tools')
  .version('1.0.0');

// Backfill command
program
  .command('backfill')
  .description('Perform historical data backfill')
  .requiredOption('-p, --pair <pair>', 'Trading pair (e.g., XAU/USD)')
  .requiredOption('-t, --timeframe <timeframe>', 'Timeframe (e.g., 15m)')
  .requiredOption('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-u, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-b, --broker <broker>', 'Broker name', 'default')
  .option('--batch-size <size>', 'Batch size for processing', '5000')
  .option('--max-retries <retries>', 'Maximum retry attempts', '3')
  .option('--no-session-filter', 'Disable trading session filtering')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async options => {
    try {
      console.log('🚀 Starting historical backfill...');
      console.log(`Pair: ${options.pair}`);
      console.log(`Timeframe: ${options.timeframe}`);
      console.log(`Date range: ${options.from} to ${options.to}`);
      console.log(`Broker: ${options.broker}`);
      console.log(
        `Session filtering: ${!options.noSessionFilter ? 'enabled' : 'disabled'}`
      );

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No data will be modified');
        return;
      }

      const fromDate = new Date(options.from);
      const toDate = new Date(options.to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }

      if (fromDate >= toDate) {
        throw new Error('Start date must be before end date');
      }

      const config: IngestionConfig = {
        pair: options.pair,
        timeframe: options.timeframe,
        brokerName: options.broker,
        enableSessionFiltering: !options.noSessionFilter,
        batchSize: parseInt(options.batchSize),
        maxRetries: parseInt(options.maxRetries),
      };

      const broker = BrokerFactory.createBroker(options.broker);
      const ingestionService = new CandleIngestionService(broker);

      console.log('⏳ Processing backfill...');
      const result = await ingestionService.backfillHistoricalData(
        config,
        fromDate,
        toDate
      );

      console.log('✅ Backfill completed!');
      console.log(`📊 Results:`);
      console.log(`  - Fetched: ${result.totalFetched} candles`);
      console.log(`  - Inserted: ${result.totalInserted} candles`);
      console.log(`  - Skipped: ${result.totalSkipped} candles`);
      console.log(`  - Errors: ${result.errors.length}`);
      console.log(
        `  - Processing time: ${(result.processingTimeMs / 1000).toFixed(2)}s`
      );

      if ('batchesProcessed' in result) {
        console.log(`  - Batches processed: ${result.batchesProcessed}`);
        console.log(
          `  - Average batch time: ${(result.averageBatchTimeMs / 1000).toFixed(2)}s`
        );
      }

      if (result.errors.length > 0) {
        console.log('⚠️  Errors encountered:');
        result.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
    } catch (error) {
      console.error(
        '❌ Backfill failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Incremental update command
program
  .command('update')
  .description('Perform incremental data update')
  .requiredOption('-p, --pair <pair>', 'Trading pair (e.g., XAU/USD)')
  .requiredOption('-t, --timeframe <timeframe>', 'Timeframe (e.g., 15m)')
  .option('-b, --broker <broker>', 'Broker name', 'default')
  .option('--lookback <hours>', 'Lookback period in hours', '24')
  .option('--no-session-filter', 'Disable trading session filtering')
  .option('--smart', 'Use smart incremental update with gap filling')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async options => {
    try {
      console.log('🔄 Starting incremental update...');
      console.log(`Pair: ${options.pair}`);
      console.log(`Timeframe: ${options.timeframe}`);
      console.log(`Broker: ${options.broker}`);
      console.log(`Lookback: ${options.lookback} hours`);
      console.log(`Smart mode: ${options.smart ? 'enabled' : 'disabled'}`);

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No data will be modified');
        return;
      }

      const config: IngestionConfig = {
        pair: options.pair,
        timeframe: options.timeframe,
        brokerName: options.broker,
        enableSessionFiltering: !options.noSessionFilter,
        batchSize: 5000,
        maxRetries: 3,
      };

      const broker = BrokerFactory.createBroker(options.broker);
      const ingestionService = new CandleIngestionService(broker);

      console.log('⏳ Processing incremental update...');

      const result = options.smart
        ? await ingestionService.smartIncrementalUpdate(config)
        : await ingestionService.updateIncremental(
            config,
            parseInt(options.lookback)
          );

      console.log('✅ Incremental update completed!');
      console.log(`📊 Results:`);
      console.log(`  - Fetched: ${result.totalFetched} candles`);
      console.log(`  - Inserted: ${result.totalInserted} candles`);
      console.log(`  - Skipped: ${result.totalSkipped} candles`);
      console.log(`  - Errors: ${result.errors.length}`);
      console.log(
        `  - Processing time: ${(result.processingTimeMs / 1000).toFixed(2)}s`
      );

      if ('newCandlesFound' in result) {
        console.log(
          `  - New candles found: ${result.newCandlesFound ? 'Yes' : 'No'}`
        );
        console.log(`  - Gap detected: ${result.gapDetected ? 'Yes' : 'No'}`);

        if (result.gapDetails) {
          console.log(
            `  - Gap duration: ${(result.gapDetails.gapDurationMs / (1000 * 60)).toFixed(2)} minutes`
          );
        }
      }

      if (result.errors.length > 0) {
        console.log('⚠️  Errors encountered:');
        result.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
    } catch (error) {
      console.error(
        '❌ Incremental update failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Verification command
program
  .command('verify')
  .description('Verify data quality and integrity')
  .requiredOption('-p, --pair <pair>', 'Trading pair (e.g., XAU/USD)')
  .requiredOption('-t, --timeframe <timeframe>', 'Timeframe (e.g., 15m)')
  .option('-f, --from <date>', 'Start date for verification (YYYY-MM-DD)')
  .option('-u, --to <date>', 'End date for verification (YYYY-MM-DD)')
  .option('--check-gaps', 'Check for timestamp gaps')
  .option('--check-duplicates', 'Check for duplicate candles')
  .option('--check-ohlc', 'Check OHLC integrity')
  .option('--check-volume', 'Check volume consistency')
  .option('--report', 'Generate comprehensive report')
  .action(async options => {
    try {
      console.log('🔍 Starting data verification...');
      console.log(`Pair: ${options.pair}`);
      console.log(`Timeframe: ${options.timeframe}`);

      const candleRepository = new CandleRepository();
      const verificationService = new DataVerificationService(candleRepository);

      const fromDate = options.from
        ? new Date(options.from)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = options.to ? new Date(options.to) : new Date();

      if (options.from || options.to) {
        console.log(
          `Date range: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`
        );
      }

      if (options.report) {
        console.log('📋 Generating comprehensive verification report...');
        const report = await verificationService.generateVerificationReport(
          options.pair,
          options.timeframe,
          fromDate,
          toDate
        );

        console.log('✅ Verification report generated!');
        console.log(`📊 Summary:`);
        console.log(`  - Total candles: ${report.totalCandles}`);
        console.log(`  - Gaps found: ${report.gaps.length}`);
        console.log(`  - Duplicates found: ${report.duplicates.length}`);
        console.log(
          `  - Valid candles: ${report.validationResult.validCandles}`
        );
        console.log(
          `  - Invalid candles: ${report.validationResult.invalidCandles}`
        );
        console.log(
          `  - Volume consistency: ${report.volumeConsistency.isConsistent ? 'Good' : 'Issues found'}`
        );

        if (report.gaps.length > 0) {
          console.log('\n🕳️  Timestamp gaps:');
          report.gaps.slice(0, 5).forEach((gap, index) => {
            console.log(
              `  ${index + 1}. Gap at ${gap.expectedTimestamp.toISOString()} (${gap.gapDurationMinutes} minutes)`
            );
          });
          if (report.gaps.length > 5) {
            console.log(`  ... and ${report.gaps.length - 5} more gaps`);
          }
        }

        if (report.duplicates.length > 0) {
          console.log('\n🔄 Duplicate candles:');
          report.duplicates.slice(0, 5).forEach((dup, index) => {
            console.log(
              `  ${index + 1}. ${dup.pair} ${dup.timeframe} at ${dup.timestamp.toISOString()}`
            );
          });
          if (report.duplicates.length > 5) {
            console.log(
              `  ... and ${report.duplicates.length - 5} more duplicates`
            );
          }
        }

        if (report.validationResult.errors.length > 0) {
          console.log('\n⚠️  Validation errors:');
          report.validationResult.errors.slice(0, 5).forEach((error, index) => {
            console.log(
              `  ${index + 1}. ${error.errorType}: ${error.errorMessage}`
            );
          });
          if (report.validationResult.errors.length > 5) {
            console.log(
              `  ... and ${report.validationResult.errors.length - 5} more errors`
            );
          }
        }

        return;
      }

      // Individual checks
      if (options.checkGaps) {
        console.log('🕳️  Checking for timestamp gaps...');
        const gaps = await verificationService.checkForGaps(
          options.pair,
          options.timeframe,
          fromDate,
          toDate
        );
        console.log(`Found ${gaps.length} gaps`);

        if (gaps.length > 0) {
          gaps.slice(0, 3).forEach((gap, index) => {
            console.log(
              `  ${index + 1}. Gap at ${gap.expectedTimestamp.toISOString()} (${gap.gapDurationMinutes} minutes)`
            );
          });
          if (gaps.length > 3) {
            console.log(`  ... and ${gaps.length - 3} more gaps`);
          }
        }
      }

      if (options.checkDuplicates) {
        console.log('🔄 Checking for duplicate candles...');
        const duplicates = await verificationService.detectDuplicates(
          options.pair,
          options.timeframe
        );
        console.log(`Found ${duplicates.length} duplicate entries`);

        if (duplicates.length > 0) {
          duplicates.slice(0, 3).forEach((dup, index) => {
            console.log(
              `  ${index + 1}. ${dup.pair} ${dup.timeframe} at ${dup.timestamp.toISOString()}`
            );
          });
          if (duplicates.length > 3) {
            console.log(`  ... and ${duplicates.length - 3} more duplicates`);
          }
        }
      }

      if (options.checkOhlc) {
        console.log('📊 Checking OHLC integrity...');
        const validation = await verificationService.validateOHLCIntegrity(
          options.pair,
          options.timeframe
        );
        console.log(
          `Valid candles: ${validation.validCandles}, Invalid: ${validation.invalidCandles}`
        );

        if (validation.errors.length > 0) {
          validation.errors.slice(0, 3).forEach((error, index) => {
            console.log(
              `  ${index + 1}. ${error.errorType}: ${error.errorMessage}`
            );
          });
          if (validation.errors.length > 3) {
            console.log(
              `  ... and ${validation.errors.length - 3} more errors`
            );
          }
        }
      }

      if (options.checkVolume) {
        console.log('📈 Checking volume consistency...');
        const volumeCheck = await verificationService.validateVolumeConsistency(
          options.pair,
          options.timeframe
        );
        console.log(
          `Volume consistency: ${volumeCheck.isConsistent ? 'Good' : 'Issues found'}`
        );
        console.log(`Candles with volume: ${volumeCheck.candlesWithVolume}`);
        console.log(
          `Candles without volume: ${volumeCheck.candlesWithoutVolume}`
        );
        console.log(`Average volume: ${volumeCheck.averageVolume.toFixed(2)}`);

        if (volumeCheck.inconsistencies.length > 0) {
          console.log('Issues:');
          volumeCheck.inconsistencies.forEach((issue, index) => {
            console.log(`  ${index + 1}. ${issue}`);
          });
        }
      }

      console.log('✅ Verification completed!');
    } catch (error) {
      console.error(
        '❌ Verification failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show ingestion system status')
  .option('--jobs', 'Show job status')
  .option('--brokers', 'Show broker status')
  .option('--alerts', 'Show active alerts')
  .option('--health', 'Show system health')
  .action(async options => {
    try {
      const managementService = new IngestionManagementService();

      if (
        options.jobs ||
        (!options.brokers && !options.alerts && !options.health)
      ) {
        console.log('📋 Job Status:');
        const jobs = managementService.listJobs({ limit: 10 });

        if (jobs.length === 0) {
          console.log('  No jobs found');
        } else {
          jobs.forEach(job => {
            const status =
              job.status === 'completed'
                ? '✅'
                : job.status === 'running'
                  ? '⏳'
                  : job.status === 'failed'
                    ? '❌'
                    : job.status === 'cancelled'
                      ? '🚫'
                      : '⏸️';

            console.log(
              `  ${status} ${job.id} - ${job.pair} ${job.timeframe} (${job.mode})`
            );
            console.log(`     Created: ${job.createdAt.toISOString()}`);
            if (job.result) {
              console.log(
                `     Result: ${job.result.totalInserted} inserted, ${job.result.errors.length} errors`
              );
            }
          });
        }
      }

      if (options.brokers) {
        console.log('\n🔌 Broker Status:');
        const brokers = managementService.listBrokerConfigurations();

        if (brokers.length === 0) {
          console.log('  No brokers configured');
        } else {
          brokers.forEach(broker => {
            const status =
              broker.enabled && broker.isHealthy
                ? '✅'
                : broker.enabled && !broker.isHealthy
                  ? '❌'
                  : '⏸️';

            console.log(`  ${status} ${broker.name} (${broker.type})`);
            console.log(`     Enabled: ${broker.enabled}`);
            console.log(`     Healthy: ${broker.isHealthy}`);
            console.log(
              `     Last check: ${broker.lastHealthCheck?.toISOString() || 'Never'}`
            );
          });
        }
      }

      if (options.alerts) {
        console.log('\n🚨 Active Alerts:');
        const alerts = managementService.getActiveAlerts();

        if (alerts.length === 0) {
          console.log('  No active alerts');
        } else {
          alerts.forEach(alert => {
            const severity =
              alert.severity === 'critical'
                ? '🔴'
                : alert.severity === 'high'
                  ? '🟠'
                  : alert.severity === 'medium'
                    ? '🟡'
                    : '🟢';

            console.log(`  ${severity} ${alert.type}: ${alert.message}`);
            console.log(`     Created: ${alert.createdAt.toISOString()}`);
            console.log(
              `     Acknowledged: ${alert.acknowledgedAt ? 'Yes' : 'No'}`
            );
          });
        }
      }

      if (options.health) {
        console.log('\n💚 System Health:');
        const stats = managementService.getIngestionStats();
        const queueStatus = managementService.getQueueStatus();

        const healthIcon =
          stats.systemHealth === 'healthy'
            ? '💚'
            : stats.systemHealth === 'degraded'
              ? '🟡'
              : '🔴';

        console.log(
          `  Overall: ${healthIcon} ${stats.systemHealth.toUpperCase()}`
        );
        console.log(`  Total jobs: ${stats.totalJobs}`);
        console.log(`  Running jobs: ${stats.runningJobs}`);
        console.log(`  Completed jobs: ${stats.completedJobs}`);
        console.log(`  Failed jobs: ${stats.failedJobs}`);
        console.log(
          `  Queue: ${queueStatus.pendingJobs} pending, ${queueStatus.runningJobs}/${queueStatus.maxConcurrentJobs} running`
        );
        console.log(
          `  Total candles ingested: ${stats.totalCandlesIngested.toLocaleString()}`
        );
        console.log(
          `  Average processing time: ${(stats.averageProcessingTime / 1000).toFixed(2)}s`
        );

        if (stats.lastSuccessfulRun) {
          console.log(
            `  Last successful run: ${stats.lastSuccessfulRun.toISOString()}`
          );
        }
      }
    } catch (error) {
      console.error(
        '❌ Status check failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Configuration command
program
  .command('config')
  .description('Manage configuration')
  .option('--validate', 'Validate current configuration')
  .option('--show-brokers', 'Show broker configurations')
  .option('--test-broker <name>', 'Test broker connection')
  .action(async options => {
    try {
      const managementService = new IngestionManagementService();

      if (options.validate) {
        console.log('🔧 Validating configuration...');

        // Test broker connections
        const brokers = managementService.listBrokerConfigurations();
        let allValid = true;

        for (const brokerConfig of brokers) {
          if (!brokerConfig.enabled) continue;

          try {
            const broker = BrokerFactory.createBroker(brokerConfig.name);
            const isValid = await broker.validateConnection();

            console.log(
              `  ${isValid ? '✅' : '❌'} ${brokerConfig.name}: ${isValid ? 'Valid' : 'Invalid'}`
            );

            if (!isValid) allValid = false;
          } catch (error) {
            console.log(
              `  ❌ ${brokerConfig.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            allValid = false;
          }
        }

        console.log(
          `\n${allValid ? '✅' : '❌'} Configuration ${allValid ? 'valid' : 'has issues'}`
        );
      }

      if (options.showBrokers) {
        console.log('🔌 Broker Configurations:');
        const brokers = managementService.listBrokerConfigurations();

        brokers.forEach(broker => {
          console.log(`\n  ${broker.name} (${broker.type}):`);
          console.log(`    Enabled: ${broker.enabled}`);
          console.log(`    Rate limit: ${broker.rateLimitPerMinute}/min`);
          console.log(`    Max concurrent jobs: ${broker.maxConcurrentJobs}`);
          console.log(
            `    Health check interval: ${broker.healthCheckInterval}ms`
          );
          console.log(
            `    Last health check: ${broker.lastHealthCheck?.toISOString() || 'Never'}`
          );
          console.log(`    Healthy: ${broker.isHealthy}`);
        });
      }

      if (options.testBroker) {
        console.log(`🧪 Testing broker connection: ${options.testBroker}`);

        try {
          const broker = BrokerFactory.createBroker(options.testBroker);
          const startTime = Date.now();
          const isValid = await broker.validateConnection();
          const duration = Date.now() - startTime;

          console.log(
            `${isValid ? '✅' : '❌'} Connection test ${isValid ? 'passed' : 'failed'} (${duration}ms)`
          );

          if (!isValid) {
            process.exit(1);
          }
        } catch (error) {
          console.error(
            `❌ Connection test failed: ${error instanceof Error ? error.message : error}`
          );
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(
        '❌ Configuration check failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Export command for data analysis
program
  .command('export')
  .description('Export candle data for analysis')
  .requiredOption('-p, --pair <pair>', 'Trading pair (e.g., XAU/USD)')
  .requiredOption('-t, --timeframe <timeframe>', 'Timeframe (e.g., 15m)')
  .option('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .option('-u, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <file>', 'Output file (CSV format)', 'export.csv')
  .option('--limit <number>', 'Maximum number of candles', '10000')
  .action(async options => {
    try {
      console.log('📤 Exporting candle data...');
      console.log(`Pair: ${options.pair}`);
      console.log(`Timeframe: ${options.timeframe}`);
      console.log(`Output: ${options.output}`);

      const candleRepository = new CandleRepository();

      let candles;
      if (options.from && options.to) {
        const fromDate = new Date(options.from);
        const toDate = new Date(options.to);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        console.log(`Date range: ${options.from} to ${options.to}`);
        candles = await candleRepository.getCandlesByDateRange(
          options.pair,
          options.timeframe,
          fromDate,
          toDate,
          parseInt(options.limit)
        );
      } else {
        candles = await candleRepository.getCandlesByPairAndTimeframe(
          options.pair,
          options.timeframe,
          parseInt(options.limit)
        );
      }

      if (candles.length === 0) {
        console.log('⚠️  No candles found for the specified criteria');
        return;
      }

      // Generate CSV content
      const csvHeader = 'timestamp,open,high,low,close,volume\n';
      const csvRows = candles
        .map(
          candle =>
            `${candle.timestamp.toISOString()},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}`
        )
        .join('\n');

      const csvContent = csvHeader + csvRows;

      // Write to file
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, csvContent, 'utf8');

      console.log('✅ Export completed!');
      console.log(`📊 Exported ${candles.length} candles to ${options.output}`);
      console.log(
        `📅 Date range: ${candles[candles.length - 1].timestamp.toISOString()} to ${candles[0].timestamp.toISOString()}`
      );
    } catch (error) {
      console.error(
        '❌ Export failed:',
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

// Parse command line arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };
