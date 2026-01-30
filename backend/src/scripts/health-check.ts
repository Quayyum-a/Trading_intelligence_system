#!/usr/bin/env node

import { CandleRepository } from '../repositories/candle.repository.js';
import { DataVerificationService } from '../services/data-verification.service.js';
import { IngestionManagementService } from '../services/ingestion-management.service.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

/**
 * Comprehensive health check script for the ingestion system
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
}

class HealthChecker {
  private results: HealthCheckResult[] = [];

  async runAllChecks(): Promise<HealthCheckResult[]> {
    console.log('🏥 Starting comprehensive health check...\n');

    await this.checkDatabase();
    await this.checkBrokers();
    await this.checkDataQuality();
    await this.checkSystemResources();
    await this.checkIngestionSystem();

    this.printSummary();
    return this.results;
  }

  private async checkDatabase(): Promise<void> {
    console.log('🗄️  Checking database connectivity...');

    try {
      const candleRepository = new CandleRepository();

      // Test basic connectivity
      const testCount = await candleRepository.getCandleCount('XAU/USD', '15m');

      this.addResult({
        component: 'database',
        status: 'healthy',
        message: 'Database connection successful',
        details: { candleCount: testCount },
      });

      console.log(
        `   ✅ Database connected (${testCount} XAU/USD 15m candles found)`
      );
    } catch (error) {
      this.addResult({
        component: 'database',
        status: 'critical',
        message: 'Database connection failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ❌ Database connection failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async checkBrokers(): Promise<void> {
    console.log('\n🔌 Checking broker connections...');

    const managementService = new IngestionManagementService();
    const brokerConfigs = managementService.listBrokerConfigurations();

    if (brokerConfigs.length === 0) {
      this.addResult({
        component: 'brokers',
        status: 'warning',
        message: 'No brokers configured',
      });
      console.log('   ⚠️  No brokers configured');
      return;
    }

    for (const brokerConfig of brokerConfigs) {
      if (!brokerConfig.enabled) {
        console.log(`   ⏸️  ${brokerConfig.name}: Disabled`);
        continue;
      }

      try {
        const startTime = Date.now();
        const broker = BrokerFactory.createBroker(brokerConfig.name);
        const isHealthy = await broker.validateConnection();
        const responseTime = Date.now() - startTime;

        if (isHealthy) {
          this.addResult({
            component: `broker_${brokerConfig.name}`,
            status: responseTime > 5000 ? 'warning' : 'healthy',
            message: `Broker ${brokerConfig.name} connection ${isHealthy ? 'successful' : 'failed'}`,
            details: {
              responseTime,
              brokerType: brokerConfig.type,
              rateLimitPerMinute: brokerConfig.rateLimitPerMinute,
            },
          });

          const statusIcon = responseTime > 5000 ? '⚠️' : '✅';
          console.log(
            `   ${statusIcon} ${brokerConfig.name}: Connected (${responseTime}ms)`
          );
        } else {
          this.addResult({
            component: `broker_${brokerConfig.name}`,
            status: 'critical',
            message: `Broker ${brokerConfig.name} connection failed`,
            details: { responseTime, brokerType: brokerConfig.type },
          });

          console.log(`   ❌ ${brokerConfig.name}: Connection failed`);
        }
      } catch (error) {
        this.addResult({
          component: `broker_${brokerConfig.name}`,
          status: 'critical',
          message: `Broker ${brokerConfig.name} error`,
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        console.log(
          `   ❌ ${brokerConfig.name}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  private async checkDataQuality(): Promise<void> {
    console.log('\n📊 Checking data quality...');

    try {
      const candleRepository = new CandleRepository();
      const verificationService = new DataVerificationService(candleRepository);

      // Check for recent data (last 7 days)
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Check gaps
      const gaps = await verificationService.checkForGaps(
        'XAU/USD',
        '15m',
        startDate,
        endDate
      );

      if (gaps.length === 0) {
        console.log('   ✅ No timestamp gaps found in recent data');
      } else {
        console.log(
          `   ⚠️  Found ${gaps.length} timestamp gaps in recent data`
        );

        // Show largest gaps
        const largestGaps = gaps
          .sort((a, b) => b.gapDurationMinutes - a.gapDurationMinutes)
          .slice(0, 3);
        largestGaps.forEach(gap => {
          console.log(
            `      - ${gap.gapDurationMinutes} minute gap at ${gap.expectedTimestamp.toISOString()}`
          );
        });
      }

      this.addResult({
        component: 'data_quality_gaps',
        status:
          gaps.length === 0
            ? 'healthy'
            : gaps.length < 5
              ? 'warning'
              : 'critical',
        message: `Found ${gaps.length} timestamp gaps in recent data`,
        details: {
          gapCount: gaps.length,
          largestGapMinutes:
            gaps.length > 0
              ? Math.max(...gaps.map(g => g.gapDurationMinutes))
              : 0,
        },
      });

      // Check duplicates
      const duplicates = await verificationService.detectDuplicates(
        'XAU/USD',
        '15m'
      );

      if (duplicates.length === 0) {
        console.log('   ✅ No duplicate candles found');
      } else {
        console.log(`   ⚠️  Found ${duplicates.length} duplicate candles`);
      }

      this.addResult({
        component: 'data_quality_duplicates',
        status:
          duplicates.length === 0
            ? 'healthy'
            : duplicates.length < 10
              ? 'warning'
              : 'critical',
        message: `Found ${duplicates.length} duplicate candles`,
        details: { duplicateCount: duplicates.length },
      });

      // Check OHLC integrity
      const validation = await verificationService.validateOHLCIntegrity(
        'XAU/USD',
        '15m'
      );

      if (validation.invalidCandles === 0) {
        console.log(
          `   ✅ All ${validation.validCandles} candles have valid OHLC relationships`
        );
      } else {
        console.log(
          `   ❌ Found ${validation.invalidCandles} candles with invalid OHLC relationships`
        );
      }

      this.addResult({
        component: 'data_quality_ohlc',
        status: validation.invalidCandles === 0 ? 'healthy' : 'critical',
        message: `OHLC validation: ${validation.validCandles} valid, ${validation.invalidCandles} invalid`,
        details: {
          validCandles: validation.validCandles,
          invalidCandles: validation.invalidCandles,
          errorCount: validation.errors.length,
        },
      });
    } catch (error) {
      this.addResult({
        component: 'data_quality',
        status: 'critical',
        message: 'Data quality check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ❌ Data quality check failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async checkSystemResources(): Promise<void> {
    console.log('\n💻 Checking system resources...');

    try {
      const memoryUsage = process.memoryUsage();
      const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

      console.log(`   📊 Memory usage: ${memoryUsedMB}MB / ${memoryTotalMB}MB`);

      const memoryStatus =
        memoryUsedMB > 1024
          ? 'critical'
          : memoryUsedMB > 512
            ? 'warning'
            : 'healthy';

      this.addResult({
        component: 'system_memory',
        status: memoryStatus,
        message: `Memory usage: ${memoryUsedMB}MB`,
        details: {
          heapUsed: memoryUsedMB,
          heapTotal: memoryTotalMB,
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
        },
      });

      // Check uptime
      const uptimeSeconds = process.uptime();
      const uptimeHours = Math.floor(uptimeSeconds / 3600);
      const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

      console.log(`   ⏱️  Process uptime: ${uptimeHours}h ${uptimeMinutes}m`);

      this.addResult({
        component: 'system_uptime',
        status: 'healthy',
        message: `Process uptime: ${uptimeHours}h ${uptimeMinutes}m`,
        details: { uptimeSeconds },
      });
    } catch (error) {
      this.addResult({
        component: 'system_resources',
        status: 'warning',
        message: 'System resource check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ⚠️  System resource check failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async checkIngestionSystem(): Promise<void> {
    console.log('\n🔄 Checking ingestion system...');

    try {
      const managementService = new IngestionManagementService();

      // Check job statistics
      const stats = managementService.getIngestionStats();
      const queueStatus = managementService.getQueueStatus();

      console.log(
        `   📋 Jobs: ${stats.totalJobs} total, ${stats.runningJobs} running, ${stats.failedJobs} failed`
      );
      console.log(
        `   📊 Queue: ${queueStatus.pendingJobs} pending, ${queueStatus.runningJobs}/${queueStatus.maxConcurrentJobs} running`
      );
      console.log(
        `   💾 Total candles ingested: ${stats.totalCandlesIngested.toLocaleString()}`
      );

      if (stats.lastSuccessfulRun) {
        const timeSinceLastRun = Date.now() - stats.lastSuccessfulRun.getTime();
        const hoursSinceLastRun = Math.floor(
          timeSinceLastRun / (1000 * 60 * 60)
        );
        console.log(`   ⏰ Last successful run: ${hoursSinceLastRun}h ago`);
      }

      // Determine system health
      let systemStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
      let statusMessage = 'Ingestion system operating normally';

      if (stats.systemHealth === 'critical') {
        systemStatus = 'critical';
        statusMessage = 'Ingestion system in critical state';
      } else if (stats.systemHealth === 'degraded') {
        systemStatus = 'warning';
        statusMessage = 'Ingestion system performance degraded';
      }

      if (stats.runningJobs > queueStatus.maxConcurrentJobs) {
        systemStatus = 'warning';
        statusMessage = 'Too many concurrent jobs running';
      }

      this.addResult({
        component: 'ingestion_system',
        status: systemStatus,
        message: statusMessage,
        details: {
          totalJobs: stats.totalJobs,
          runningJobs: stats.runningJobs,
          failedJobs: stats.failedJobs,
          queueSize: queueStatus.pendingJobs,
          systemHealth: stats.systemHealth,
          totalCandlesIngested: stats.totalCandlesIngested,
        },
      });

      // Check for active alerts
      const alerts = managementService.getActiveAlerts();
      if (alerts.length > 0) {
        console.log(`   🚨 Active alerts: ${alerts.length}`);

        const criticalAlerts = alerts.filter(
          a => a.severity === 'critical'
        ).length;
        if (criticalAlerts > 0) {
          console.log(`      - ${criticalAlerts} critical alerts`);
        }

        this.addResult({
          component: 'ingestion_alerts',
          status: criticalAlerts > 0 ? 'critical' : 'warning',
          message: `${alerts.length} active alerts (${criticalAlerts} critical)`,
          details: {
            totalAlerts: alerts.length,
            criticalAlerts,
            alertTypes: alerts.map(a => a.type),
          },
        });
      } else {
        console.log('   ✅ No active alerts');

        this.addResult({
          component: 'ingestion_alerts',
          status: 'healthy',
          message: 'No active alerts',
        });
      }
    } catch (error) {
      this.addResult({
        component: 'ingestion_system',
        status: 'critical',
        message: 'Ingestion system check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ❌ Ingestion system check failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private addResult(result: Omit<HealthCheckResult, 'timestamp'>): void {
    this.results.push({
      ...result,
      timestamp: new Date(),
    });
  }

  private printSummary(): void {
    console.log('\n📋 Health Check Summary:');
    console.log('========================');

    const healthyCount = this.results.filter(
      r => r.status === 'healthy'
    ).length;
    const warningCount = this.results.filter(
      r => r.status === 'warning'
    ).length;
    const criticalCount = this.results.filter(
      r => r.status === 'critical'
    ).length;

    console.log(`✅ Healthy: ${healthyCount}`);
    console.log(`⚠️  Warning: ${warningCount}`);
    console.log(`❌ Critical: ${criticalCount}`);

    if (criticalCount > 0) {
      console.log('\n🚨 Critical Issues:');
      this.results
        .filter(r => r.status === 'critical')
        .forEach(result => {
          console.log(`   - ${result.component}: ${result.message}`);
        });
    }

    if (warningCount > 0) {
      console.log('\n⚠️  Warnings:');
      this.results
        .filter(r => r.status === 'warning')
        .forEach(result => {
          console.log(`   - ${result.component}: ${result.message}`);
        });
    }

    const overallStatus =
      criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'HEALTHY';

    const statusIcon =
      overallStatus === 'HEALTHY'
        ? '💚'
        : overallStatus === 'WARNING'
          ? '🟡'
          : '🔴';

    console.log(`\n${statusIcon} Overall Status: ${overallStatus}`);
  }
}

// Run health check if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new HealthChecker();

  checker
    .runAllChecks()
    .then(results => {
      const criticalCount = results.filter(r => r.status === 'critical').length;
      process.exit(criticalCount > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Health check failed:', error);
      process.exit(1);
    });
}

export { HealthChecker };
