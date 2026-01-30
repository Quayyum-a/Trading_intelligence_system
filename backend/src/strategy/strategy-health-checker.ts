import { logger } from '../config/logger.js';
import type { StrategyConfig, EngineStatus } from './strategy.types.js';
import { StrategyMonitoringService } from './strategy-monitoring.service.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

/**
 * Strategy Health Checker
 * 
 * Comprehensive health monitoring for the strategy engine system
 * Requirements: 6.1, 6.2, 6.3, 8.1
 */

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
}

export interface SystemHealthReport {
  overallStatus: 'healthy' | 'warning' | 'critical';
  timestamp: Date;
  components: HealthCheckResult[];
  summary: {
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    totalChecks: number;
  };
  recommendations: string[];
}

export class StrategyHealthChecker {
  private monitoringService: StrategyMonitoringService;
  private results: HealthCheckResult[] = [];

  constructor(monitoringService?: StrategyMonitoringService) {
    this.monitoringService = monitoringService || new StrategyMonitoringService();
  }

  /**
   * Run comprehensive health check
   */
  async runHealthCheck(
    engineStatus: EngineStatus,
    config: StrategyConfig
  ): Promise<SystemHealthReport> {
    logger.info('Starting strategy engine health check');
    this.results = [];

    try {
      // Run all health checks
      await this.checkEngineStatus(engineStatus);
      await this.checkPerformanceMetrics();
      await this.checkDecisionQuality(config);
      await this.checkSystemResources();
      await this.checkAuditCompliance();
      await this.checkAlertStatus();
      await this.checkDatabaseConnectivity();

      // Generate report
      const report = this.generateHealthReport();
      
      logger.info('Strategy engine health check completed', {
        overallStatus: report.overallStatus,
        healthyCount: report.summary.healthyCount,
        warningCount: report.summary.warningCount,
        criticalCount: report.summary.criticalCount
      });

      return report;

    } catch (error) {
      logger.error('Health check failed', { error });
      
      this.addResult({
        component: 'health_checker',
        status: 'critical',
        message: 'Health check system failure',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });

      return this.generateHealthReport();
    }
  }

  /**
   * Check engine status
   */
  private async checkEngineStatus(engineStatus: EngineStatus): Promise<void> {
    if (!engineStatus.isRunning) {
      this.addResult({
        component: 'engine_status',
        status: 'critical',
        message: 'Strategy engine is not running',
        details: { status: engineStatus }
      });
      return;
    }

    // Check for recent activity
    const now = new Date();
    const timeSinceLastCandle = engineStatus.lastProcessedCandle 
      ? now.getTime() - engineStatus.lastProcessedCandle.getTime()
      : null;

    if (timeSinceLastCandle && timeSinceLastCandle > 30 * 60 * 1000) { // 30 minutes
      this.addResult({
        component: 'engine_activity',
        status: 'warning',
        message: 'No recent candle processing activity',
        details: { 
          lastProcessedCandle: engineStatus.lastProcessedCandle,
          minutesSinceLastActivity: Math.floor(timeSinceLastCandle / (60 * 1000))
        }
      });
    } else {
      this.addResult({
        component: 'engine_activity',
        status: 'healthy',
        message: 'Engine processing candles regularly',
        details: { 
          lastProcessedCandle: engineStatus.lastProcessedCandle,
          totalDecisions: engineStatus.totalDecisions,
          totalSignals: engineStatus.totalSignals
        }
      });
    }

    // Check error rate
    if (engineStatus.errors.length > 10) {
      this.addResult({
        component: 'engine_errors',
        status: 'critical',
        message: `High error count: ${engineStatus.errors.length} errors`,
        details: { 
          errorCount: engineStatus.errors.length,
          recentErrors: engineStatus.errors.slice(-3)
        }
      });
    } else if (engineStatus.errors.length > 5) {
      this.addResult({
        component: 'engine_errors',
        status: 'warning',
        message: `Moderate error count: ${engineStatus.errors.length} errors`,
        details: { 
          errorCount: engineStatus.errors.length,
          recentErrors: engineStatus.errors.slice(-2)
        }
      });
    } else {
      this.addResult({
        component: 'engine_errors',
        status: 'healthy',
        message: `Low error count: ${engineStatus.errors.length} errors`,
        details: { errorCount: engineStatus.errors.length }
      });
    }
  }

  /**
   * Check performance metrics
   */
  private async checkPerformanceMetrics(): Promise<void> {
    try {
      const metrics = await this.monitoringService.getMetrics();
      
      // Check decision processing time
      if (metrics.performance.avgDecisionTimeMs > 2000) {
        this.addResult({
          component: 'performance_timing',
          status: 'critical',
          message: 'Very slow decision processing',
          details: { avgDecisionTimeMs: metrics.performance.avgDecisionTimeMs }
        });
      } else if (metrics.performance.avgDecisionTimeMs > 1000) {
        this.addResult({
          component: 'performance_timing',
          status: 'warning',
          message: 'Slow decision processing',
          details: { avgDecisionTimeMs: metrics.performance.avgDecisionTimeMs }
        });
      } else {
        this.addResult({
          component: 'performance_timing',
          status: 'healthy',
          message: 'Good decision processing speed',
          details: { avgDecisionTimeMs: metrics.performance.avgDecisionTimeMs }
        });
      }

      // Check memory usage
      if (metrics.performance.memoryUsageMB > 1024) {
        this.addResult({
          component: 'performance_memory',
          status: 'critical',
          message: 'Very high memory usage',
          details: { memoryUsageMB: metrics.performance.memoryUsageMB }
        });
      } else if (metrics.performance.memoryUsageMB > 512) {
        this.addResult({
          component: 'performance_memory',
          status: 'warning',
          message: 'High memory usage',
          details: { memoryUsageMB: metrics.performance.memoryUsageMB }
        });
      } else {
        this.addResult({
          component: 'performance_memory',
          status: 'healthy',
          message: 'Normal memory usage',
          details: { memoryUsageMB: metrics.performance.memoryUsageMB }
        });
      }

    } catch (error) {
      this.addResult({
        component: 'performance_metrics',
        status: 'warning',
        message: 'Failed to retrieve performance metrics',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Check decision quality
   */
  private async checkDecisionQuality(config: StrategyConfig): Promise<void> {
    try {
      const metrics = await this.monitoringService.getMetrics();
      
      // Check average confidence score
      if (metrics.decisionQuality.avgConfidenceScore < config.confidence.minThreshold * 0.7) {
        this.addResult({
          component: 'decision_confidence',
          status: 'critical',
          message: 'Very low average confidence score',
          details: { 
            avgConfidence: metrics.decisionQuality.avgConfidenceScore,
            threshold: config.confidence.minThreshold
          }
        });
      } else if (metrics.decisionQuality.avgConfidenceScore < config.confidence.minThreshold * 0.9) {
        this.addResult({
          component: 'decision_confidence',
          status: 'warning',
          message: 'Low average confidence score',
          details: { 
            avgConfidence: metrics.decisionQuality.avgConfidenceScore,
            threshold: config.confidence.minThreshold
          }
        });
      } else {
        this.addResult({
          component: 'decision_confidence',
          status: 'healthy',
          message: 'Good average confidence score',
          details: { 
            avgConfidence: metrics.decisionQuality.avgConfidenceScore,
            threshold: config.confidence.minThreshold
          }
        });
      }

      // Check signal generation rate
      const signalRate = metrics.decisionQuality.totalDecisions > 0 
        ? (metrics.decisionQuality.tradeSignals / metrics.decisionQuality.totalDecisions) * 100
        : 0;

      if (signalRate < 2) {
        this.addResult({
          component: 'signal_generation',
          status: 'warning',
          message: 'Very low signal generation rate',
          details: { 
            signalRate,
            totalDecisions: metrics.decisionQuality.totalDecisions,
            tradeSignals: metrics.decisionQuality.tradeSignals
          }
        });
      } else if (signalRate > 60) {
        this.addResult({
          component: 'signal_generation',
          status: 'warning',
          message: 'Unusually high signal generation rate',
          details: { 
            signalRate,
            totalDecisions: metrics.decisionQuality.totalDecisions,
            tradeSignals: metrics.decisionQuality.tradeSignals
          }
        });
      } else {
        this.addResult({
          component: 'signal_generation',
          status: 'healthy',
          message: 'Normal signal generation rate',
          details: { 
            signalRate,
            totalDecisions: metrics.decisionQuality.totalDecisions,
            tradeSignals: metrics.decisionQuality.tradeSignals
          }
        });
      }

    } catch (error) {
      this.addResult({
        component: 'decision_quality',
        status: 'warning',
        message: 'Failed to check decision quality',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Check system resources
   */
  private async checkSystemResources(): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();
      const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

      // Check memory limits
      const memoryLimits = {
        maxHeapUsedMB: 1024,
        maxRssMB: 2048
      };

      const memoryCheck = performanceMonitor.checkMemoryLimits(memoryLimits);
      
      if (!memoryCheck.withinLimits) {
        this.addResult({
          component: 'system_memory',
          status: 'critical',
          message: 'Memory usage exceeds limits',
          details: {
            violations: memoryCheck.violations,
            currentUsage: {
              heapUsedMB: memoryUsedMB,
              heapTotalMB: memoryTotalMB,
              rssMB: Math.round(memoryUsage.rss / 1024 / 1024)
            }
          }
        });
      } else {
        this.addResult({
          component: 'system_memory',
          status: 'healthy',
          message: 'Memory usage within limits',
          details: {
            heapUsedMB: memoryUsedMB,
            heapTotalMB: memoryTotalMB,
            rssMB: Math.round(memoryUsage.rss / 1024 / 1024)
          }
        });
      }

      // Check uptime
      const uptimeSeconds = process.uptime();
      const uptimeHours = Math.floor(uptimeSeconds / 3600);

      this.addResult({
        component: 'system_uptime',
        status: 'healthy',
        message: `System uptime: ${uptimeHours} hours`,
        details: { 
          uptimeSeconds,
          uptimeHours,
          uptimeFormatted: `${Math.floor(uptimeHours / 24)}d ${uptimeHours % 24}h`
        }
      });

    } catch (error) {
      this.addResult({
        component: 'system_resources',
        status: 'warning',
        message: 'Failed to check system resources',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Check audit compliance
   */
  private async checkAuditCompliance(): Promise<void> {
    try {
      const metrics = await this.monitoringService.getMetrics();
      
      if (metrics.auditCompliance.auditLogCompleteness < 90) {
        this.addResult({
          component: 'audit_compliance',
          status: 'critical',
          message: 'Poor audit log completeness',
          details: { 
            completeness: metrics.auditCompliance.auditLogCompleteness,
            dataIntegrityScore: metrics.auditCompliance.dataIntegrityScore
          }
        });
      } else if (metrics.auditCompliance.auditLogCompleteness < 98) {
        this.addResult({
          component: 'audit_compliance',
          status: 'warning',
          message: 'Moderate audit log completeness',
          details: { 
            completeness: metrics.auditCompliance.auditLogCompleteness,
            dataIntegrityScore: metrics.auditCompliance.dataIntegrityScore
          }
        });
      } else {
        this.addResult({
          component: 'audit_compliance',
          status: 'healthy',
          message: 'Excellent audit log completeness',
          details: { 
            completeness: metrics.auditCompliance.auditLogCompleteness,
            dataIntegrityScore: metrics.auditCompliance.dataIntegrityScore
          }
        });
      }

    } catch (error) {
      this.addResult({
        component: 'audit_compliance',
        status: 'warning',
        message: 'Failed to check audit compliance',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Check alert status
   */
  private async checkAlertStatus(): Promise<void> {
    try {
      const activeAlerts = this.monitoringService.getActiveAlerts();
      const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
      const highAlerts = activeAlerts.filter(a => a.severity === 'high');

      if (criticalAlerts.length > 0) {
        this.addResult({
          component: 'active_alerts',
          status: 'critical',
          message: `${criticalAlerts.length} critical alerts active`,
          details: { 
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            highAlerts: highAlerts.length,
            recentAlerts: criticalAlerts.slice(0, 3).map(a => ({
              type: a.type,
              message: a.message,
              timestamp: a.timestamp
            }))
          }
        });
      } else if (highAlerts.length > 2) {
        this.addResult({
          component: 'active_alerts',
          status: 'warning',
          message: `${highAlerts.length} high-priority alerts active`,
          details: { 
            totalAlerts: activeAlerts.length,
            highAlerts: highAlerts.length,
            recentAlerts: highAlerts.slice(0, 2).map(a => ({
              type: a.type,
              message: a.message,
              timestamp: a.timestamp
            }))
          }
        });
      } else if (activeAlerts.length > 5) {
        this.addResult({
          component: 'active_alerts',
          status: 'warning',
          message: `${activeAlerts.length} alerts active`,
          details: { totalAlerts: activeAlerts.length }
        });
      } else {
        this.addResult({
          component: 'active_alerts',
          status: 'healthy',
          message: `${activeAlerts.length} alerts active`,
          details: { totalAlerts: activeAlerts.length }
        });
      }

    } catch (error) {
      this.addResult({
        component: 'alert_status',
        status: 'warning',
        message: 'Failed to check alert status',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Check database connectivity
   */
  private async checkDatabaseConnectivity(): Promise<void> {
    try {
      // Test basic database operations
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const now = new Date();
      
      const recentDecisions = await this.monitoringService['decisionRepository'].getDecisionsByDateRange(
        oneHourAgo,
        now
      );

      this.addResult({
        component: 'database_connectivity',
        status: 'healthy',
        message: 'Database connectivity verified',
        details: { 
          recentDecisions: recentDecisions.length,
          testTimestamp: now
        }
      });

    } catch (error) {
      this.addResult({
        component: 'database_connectivity',
        status: 'critical',
        message: 'Database connectivity failed',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  /**
   * Add health check result
   */
  private addResult(result: Omit<HealthCheckResult, 'timestamp'>): void {
    this.results.push({
      ...result,
      timestamp: new Date()
    });
  }

  /**
   * Generate comprehensive health report
   */
  private generateHealthReport(): SystemHealthReport {
    const healthyCount = this.results.filter(r => r.status === 'healthy').length;
    const warningCount = this.results.filter(r => r.status === 'warning').length;
    const criticalCount = this.results.filter(r => r.status === 'critical').length;

    // Determine overall status
    let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (criticalCount > 0) {
      overallStatus = 'critical';
    } else if (warningCount > 0) {
      overallStatus = 'warning';
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations();

    return {
      overallStatus,
      timestamp: new Date(),
      components: [...this.results],
      summary: {
        healthyCount,
        warningCount,
        criticalCount,
        totalChecks: this.results.length
      },
      recommendations
    };
  }

  /**
   * Generate health recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const criticalIssues = this.results.filter(r => r.status === 'critical');
    const warningIssues = this.results.filter(r => r.status === 'warning');

    // Critical issue recommendations
    criticalIssues.forEach(issue => {
      switch (issue.component) {
        case 'engine_status':
          recommendations.push('Restart the strategy engine immediately');
          break;
        case 'performance_timing':
          recommendations.push('Investigate performance bottlenecks and optimize decision processing');
          break;
        case 'performance_memory':
          recommendations.push('Reduce memory usage or increase available memory');
          break;
        case 'system_memory':
          recommendations.push('Free up system memory or restart the application');
          break;
        case 'database_connectivity':
          recommendations.push('Check database connection and network connectivity');
          break;
        case 'active_alerts':
          recommendations.push('Address critical alerts immediately');
          break;
        case 'audit_compliance':
          recommendations.push('Investigate audit logging failures and fix data integrity issues');
          break;
      }
    });

    // Warning issue recommendations
    warningIssues.forEach(issue => {
      switch (issue.component) {
        case 'engine_activity':
          recommendations.push('Check market data feed and candle ingestion');
          break;
        case 'decision_confidence':
          recommendations.push('Review strategy parameters and market conditions');
          break;
        case 'signal_generation':
          recommendations.push('Analyze signal generation patterns and adjust thresholds if needed');
          break;
        case 'engine_errors':
          recommendations.push('Review error logs and fix recurring issues');
          break;
      }
    });

    // General recommendations
    if (recommendations.length === 0) {
      recommendations.push('System is operating normally - continue monitoring');
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }
}