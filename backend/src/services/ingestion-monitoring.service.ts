import { BaseRepository } from '../repositories/base.repository.js';
import { getLogger } from '../config/logger.js';
import type {
  IngestionResult,
  BackfillResult,
  IncrementalResult,
} from './candle-ingestion.service.js';
import type {
  IngestionJob,
  IngestionAlert,
} from './ingestion-management.service.js';

export interface IngestionMetrics {
  timestamp: Date;
  pair: string;
  timeframe: string;
  broker: string;
  operation: 'backfill' | 'incremental' | 'manual';

  // Performance metrics
  processingTimeMs: number;
  candlesFetched: number;
  candlesNormalized: number;
  candlesFiltered: number;
  candlesInserted: number;
  candlesSkipped: number;
  errorCount: number;

  // Rate metrics
  fetchRate: number; // candles per second
  insertRate: number; // candles per second
  errorRate: number; // errors per total operations

  // Resource metrics
  memoryUsageMB?: number;
  cpuUsagePercent?: number;

  // Data quality metrics
  duplicateRate: number;
  gapCount?: number;
  ohlcValidationErrors?: number;
}

export interface PerformanceAlert {
  type:
    | 'slow_processing'
    | 'high_error_rate'
    | 'memory_usage'
    | 'broker_timeout';
  severity: 'low' | 'medium' | 'high' | 'critical';
  threshold: number;
  actualValue: number;
  message: string;
  recommendations: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  operation: string;
  actor: 'system' | 'user' | 'scheduler';
  actorId?: string;
  resource: string;
  resourceId: string;
  action: 'create' | 'update' | 'delete' | 'execute' | 'cancel';
  details: Record<string, any>;
  result: 'success' | 'failure' | 'partial';
  errorMessage?: string;
}

export interface SystemHealthMetrics {
  timestamp: Date;
  overallHealth: 'healthy' | 'degraded' | 'critical';

  // Job metrics
  activeJobs: number;
  queuedJobs: number;
  completedJobsLast24h: number;
  failedJobsLast24h: number;
  averageJobDuration: number;

  // Broker metrics
  activeBrokers: number;
  healthyBrokers: number;
  brokerResponseTimes: Record<string, number>;

  // Data metrics
  totalCandlesIngested: number;
  ingestRateLast1h: number;
  dataQualityScore: number;

  // System metrics
  memoryUsage: number;
  cpuUsage: number;
  diskUsage?: number;

  // Alert metrics
  activeAlerts: number;
  criticalAlerts: number;
}

export interface MonitoringConfiguration {
  enableMetricsCollection: boolean;
  enablePerformanceAlerts: boolean;
  enableAuditLogging: boolean;

  // Thresholds
  slowProcessingThresholdMs: number;
  highErrorRateThreshold: number;
  memoryUsageThresholdMB: number;

  // Retention
  metricsRetentionDays: number;
  auditLogRetentionDays: number;

  // Sampling
  metricsSamplingRate: number; // 0.0 to 1.0
  detailedLoggingEnabled: boolean;
}

export class IngestionMonitoringService extends BaseRepository {
  private metrics: Map<string, IngestionMetrics> = new Map();
  private auditLogs: Map<string, AuditLogEntry> = new Map();
  private performanceAlerts: PerformanceAlert[] = [];
  private config: MonitoringConfiguration;
  private logger = getLogger();

  constructor(config?: Partial<MonitoringConfiguration>) {
    super();
    this.config = {
      enableMetricsCollection: true,
      enablePerformanceAlerts: true,
      enableAuditLogging: true,
      slowProcessingThresholdMs: 30000, // 30 seconds
      highErrorRateThreshold: 0.1, // 10%
      memoryUsageThresholdMB: 1024, // 1GB
      metricsRetentionDays: 30,
      auditLogRetentionDays: 90,
      metricsSamplingRate: 1.0,
      detailedLoggingEnabled: true,
      ...config,
    };

    this.logger.info('Ingestion monitoring service initialized', {
      config: this.config,
    });
  }

  /**
   * Records ingestion metrics from job results
   * Requirements: 4.3, 5.5, 7.5
   */
  recordIngestionMetrics(
    job: IngestionJob,
    result: IngestionResult | BackfillResult | IncrementalResult,
    brokerName: string
  ): void {
    if (!this.config.enableMetricsCollection) {
      return;
    }

    // Sample based on configuration
    if (Math.random() > this.config.metricsSamplingRate) {
      return;
    }

    const metrics: IngestionMetrics = {
      timestamp: new Date(),
      pair: job.pair,
      timeframe: job.timeframe,
      broker: brokerName,
      operation: job.mode,

      processingTimeMs: result.processingTimeMs,
      candlesFetched: result.totalFetched,
      candlesNormalized: result.totalNormalized,
      candlesFiltered: result.totalFiltered,
      candlesInserted: result.totalInserted,
      candlesSkipped: result.totalSkipped,
      errorCount: result.errors.length,

      fetchRate:
        result.processingTimeMs > 0
          ? result.totalFetched / (result.processingTimeMs / 1000)
          : 0,
      insertRate:
        result.processingTimeMs > 0
          ? result.totalInserted / (result.processingTimeMs / 1000)
          : 0,
      errorRate:
        result.totalFetched > 0
          ? result.errors.length / result.totalFetched
          : 0,

      duplicateRate:
        result.totalFetched > 0 ? result.totalSkipped / result.totalFetched : 0,

      memoryUsageMB: this.getCurrentMemoryUsage(),
      cpuUsagePercent: this.getCurrentCpuUsage(),
    };

    // Add backfill-specific metrics
    if ('batchesProcessed' in result) {
      metrics.gapCount = 0; // Could be enhanced to track gaps
    }

    // Add incremental-specific metrics
    if ('gapDetected' in result) {
      metrics.gapCount = result.gapDetected ? 1 : 0;
    }

    const metricsId = this.generateMetricsId(job.id);
    this.metrics.set(metricsId, metrics);

    // Log structured metrics
    this.logger.info('Ingestion metrics recorded', {
      event: 'ingestion_metrics',
      jobId: job.id,
      metrics: {
        pair: metrics.pair,
        timeframe: metrics.timeframe,
        broker: metrics.broker,
        operation: metrics.operation,
        processingTimeMs: metrics.processingTimeMs,
        candlesFetched: metrics.candlesFetched,
        candlesInserted: metrics.candlesInserted,
        candlesSkipped: metrics.candlesSkipped,
        errorCount: metrics.errorCount,
        fetchRate: Math.round(metrics.fetchRate * 100) / 100,
        insertRate: Math.round(metrics.insertRate * 100) / 100,
        errorRate: Math.round(metrics.errorRate * 10000) / 10000,
        duplicateRate: Math.round(metrics.duplicateRate * 10000) / 10000,
      },
    });

    // Check for performance alerts
    if (this.config.enablePerformanceAlerts) {
      this.checkPerformanceThresholds(metrics, job);
    }

    // Clean up old metrics
    this.cleanupOldMetrics();
  }

  /**
   * Records audit log entries for all ingestion operations
   * Requirements: 4.3, 5.5, 7.5
   */
  recordAuditLog(
    operation: string,
    actor: AuditLogEntry['actor'],
    resource: string,
    resourceId: string,
    action: AuditLogEntry['action'],
    details: Record<string, any>,
    result: AuditLogEntry['result'],
    actorId?: string,
    errorMessage?: string
  ): void {
    if (!this.config.enableAuditLogging) {
      return;
    }

    const auditEntry: AuditLogEntry = {
      id: this.generateAuditId(),
      timestamp: new Date(),
      operation,
      actor,
      actorId,
      resource,
      resourceId,
      action,
      details,
      result,
      errorMessage,
    };

    this.auditLogs.set(auditEntry.id, auditEntry);

    // Log audit entry
    this.logger.info('Audit log entry recorded', {
      event: 'audit_log',
      auditId: auditEntry.id,
      operation: auditEntry.operation,
      actor: auditEntry.actor,
      actorId: auditEntry.actorId,
      resource: auditEntry.resource,
      resourceId: auditEntry.resourceId,
      action: auditEntry.action,
      result: auditEntry.result,
      errorMessage: auditEntry.errorMessage,
      details: auditEntry.details,
    });

    // Clean up old audit logs
    this.cleanupOldAuditLogs();
  }

  /**
   * Tracks error patterns and generates alerts
   * Requirements: 4.3, 5.5
   */
  trackError(
    error: Error,
    context: {
      jobId?: string;
      pair?: string;
      timeframe?: string;
      broker?: string;
      operation?: string;
      phase?: string;
    }
  ): void {
    const errorDetails = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      context,
    };

    // Log structured error
    this.logger.error('Ingestion error tracked', {
      event: 'ingestion_error',
      error: errorDetails,
      context,
    });

    // Record audit log for error
    if (context.jobId) {
      this.recordAuditLog(
        context.operation || 'unknown_operation',
        'system',
        'ingestion_job',
        context.jobId,
        'execute',
        { error: errorDetails },
        'failure',
        undefined,
        error.message
      );
    }

    // Check for error patterns that might indicate systemic issues
    this.analyzeErrorPatterns(error, context);
  }

  /**
   * Records performance timing for specific operations
   */
  recordPerformanceTiming(
    operation: string,
    durationMs: number,
    context: Record<string, any> = {}
  ): void {
    this.logger.debug('Performance timing recorded', {
      event: 'performance_timing',
      operation,
      durationMs,
      context,
      timestamp: new Date().toISOString(),
    });

    // Check if operation is slower than expected
    if (this.config.enablePerformanceAlerts) {
      const threshold = this.getPerformanceThreshold(operation);
      if (durationMs > threshold) {
        this.performanceAlerts.push({
          type: 'slow_processing',
          severity: this.calculateSeverity(durationMs, threshold),
          threshold,
          actualValue: durationMs,
          message: `Slow ${operation}: ${durationMs}ms (threshold: ${threshold}ms)`,
          recommendations: this.getPerformanceRecommendations(
            operation,
            durationMs
          ),
        });
      }
    }
  }

  /**
   * Generates system health metrics
   */
  generateSystemHealthMetrics(
    activeJobs: number,
    queuedJobs: number,
    brokerHealth: Record<string, { healthy: boolean; responseTime: number }>,
    totalCandlesIngested: number
  ): SystemHealthMetrics {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last1h = new Date(now.getTime() - 60 * 60 * 1000);

    // Calculate job metrics from recent metrics
    const recentMetrics = Array.from(this.metrics.values()).filter(
      m => m.timestamp > last24h
    );

    const completedJobsLast24h = recentMetrics.length;
    const failedJobsLast24h = recentMetrics.filter(
      m => m.errorCount > 0
    ).length;
    const averageJobDuration =
      recentMetrics.length > 0
        ? recentMetrics.reduce((sum, m) => sum + m.processingTimeMs, 0) /
          recentMetrics.length
        : 0;

    // Calculate broker metrics
    const activeBrokers = Object.keys(brokerHealth).length;
    const healthyBrokers = Object.values(brokerHealth).filter(
      b => b.healthy
    ).length;
    const brokerResponseTimes = Object.fromEntries(
      Object.entries(brokerHealth).map(([name, health]) => [
        name,
        health.responseTime,
      ])
    );

    // Calculate ingestion rate for last hour
    const last1hMetrics = recentMetrics.filter(m => m.timestamp > last1h);
    const ingestRateLast1h = last1hMetrics.reduce(
      (sum, m) => sum + m.candlesInserted,
      0
    );

    // Calculate data quality score (simplified)
    const dataQualityScore = this.calculateDataQualityScore(recentMetrics);

    // Determine overall health
    let overallHealth: SystemHealthMetrics['overallHealth'] = 'healthy';
    if (
      healthyBrokers < activeBrokers * 0.5 ||
      failedJobsLast24h > completedJobsLast24h * 0.2
    ) {
      overallHealth = 'critical';
    } else if (healthyBrokers < activeBrokers || failedJobsLast24h > 0) {
      overallHealth = 'degraded';
    }

    const healthMetrics: SystemHealthMetrics = {
      timestamp: now,
      overallHealth,
      activeJobs,
      queuedJobs,
      completedJobsLast24h,
      failedJobsLast24h,
      averageJobDuration,
      activeBrokers,
      healthyBrokers,
      brokerResponseTimes,
      totalCandlesIngested,
      ingestRateLast1h,
      dataQualityScore,
      memoryUsage: this.getCurrentMemoryUsage(),
      cpuUsage: this.getCurrentCpuUsage(),
      activeAlerts: this.performanceAlerts.length,
      criticalAlerts: this.performanceAlerts.filter(
        a => a.severity === 'critical'
      ).length,
    };

    // Log system health
    this.logger.info('System health metrics generated', {
      event: 'system_health',
      metrics: healthMetrics,
    });

    return healthMetrics;
  }

  /**
   * Gets performance metrics for a specific time range
   */
  getMetrics(
    fromDate: Date,
    toDate: Date,
    filters?: {
      pair?: string;
      timeframe?: string;
      broker?: string;
      operation?: string;
    }
  ): IngestionMetrics[] {
    let metrics = Array.from(this.metrics.values()).filter(
      m => m.timestamp >= fromDate && m.timestamp <= toDate
    );

    if (filters) {
      if (filters.pair) {
        metrics = metrics.filter(m => m.pair === filters.pair);
      }
      if (filters.timeframe) {
        metrics = metrics.filter(m => m.timeframe === filters.timeframe);
      }
      if (filters.broker) {
        metrics = metrics.filter(m => m.broker === filters.broker);
      }
      if (filters.operation) {
        metrics = metrics.filter(m => m.operation === filters.operation);
      }
    }

    return metrics.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Gets audit logs for a specific time range
   */
  getAuditLogs(
    fromDate: Date,
    toDate: Date,
    filters?: {
      operation?: string;
      actor?: string;
      resource?: string;
      action?: string;
      result?: string;
    }
  ): AuditLogEntry[] {
    let logs = Array.from(this.auditLogs.values()).filter(
      l => l.timestamp >= fromDate && l.timestamp <= toDate
    );

    if (filters) {
      if (filters.operation) {
        logs = logs.filter(l => l.operation === filters.operation);
      }
      if (filters.actor) {
        logs = logs.filter(l => l.actor === filters.actor);
      }
      if (filters.resource) {
        logs = logs.filter(l => l.resource === filters.resource);
      }
      if (filters.action) {
        logs = logs.filter(l => l.action === filters.action);
      }
      if (filters.result) {
        logs = logs.filter(l => l.result === filters.result);
      }
    }

    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Gets current performance alerts
   */
  getPerformanceAlerts(): PerformanceAlert[] {
    return [...this.performanceAlerts].sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Clears resolved performance alerts
   */
  clearPerformanceAlerts(type?: PerformanceAlert['type']): void {
    if (type) {
      this.performanceAlerts = this.performanceAlerts.filter(
        a => a.type !== type
      );
    } else {
      this.performanceAlerts = [];
    }

    this.logger.info('Performance alerts cleared', { type });
  }

  /**
   * Updates monitoring configuration
   */
  updateConfiguration(config: Partial<MonitoringConfiguration>): void {
    this.config = { ...this.config, ...config };

    this.logger.info('Monitoring configuration updated', {
      event: 'config_update',
      newConfig: this.config,
    });
  }

  /**
   * Checks performance thresholds and generates alerts
   */
  private checkPerformanceThresholds(
    metrics: IngestionMetrics,
    job: IngestionJob
  ): void {
    // Check processing time
    if (metrics.processingTimeMs > this.config.slowProcessingThresholdMs) {
      this.performanceAlerts.push({
        type: 'slow_processing',
        severity: this.calculateSeverity(
          metrics.processingTimeMs,
          this.config.slowProcessingThresholdMs
        ),
        threshold: this.config.slowProcessingThresholdMs,
        actualValue: metrics.processingTimeMs,
        message: `Slow ingestion for ${job.pair} ${job.timeframe}: ${metrics.processingTimeMs}ms`,
        recommendations: [
          'Check broker API response times',
          'Consider reducing batch size',
          'Verify network connectivity',
          'Check system resource usage',
        ],
      });
    }

    // Check error rate
    if (metrics.errorRate > this.config.highErrorRateThreshold) {
      this.performanceAlerts.push({
        type: 'high_error_rate',
        severity: this.calculateSeverity(
          metrics.errorRate,
          this.config.highErrorRateThreshold
        ),
        threshold: this.config.highErrorRateThreshold,
        actualValue: metrics.errorRate,
        message: `High error rate for ${job.pair} ${job.timeframe}: ${(metrics.errorRate * 100).toFixed(2)}%`,
        recommendations: [
          'Check broker API status',
          'Verify authentication credentials',
          'Review data validation rules',
          'Check for network issues',
        ],
      });
    }

    // Check memory usage
    if (
      metrics.memoryUsageMB &&
      metrics.memoryUsageMB > this.config.memoryUsageThresholdMB
    ) {
      this.performanceAlerts.push({
        type: 'memory_usage',
        severity: this.calculateSeverity(
          metrics.memoryUsageMB,
          this.config.memoryUsageThresholdMB
        ),
        threshold: this.config.memoryUsageThresholdMB,
        actualValue: metrics.memoryUsageMB,
        message: `High memory usage during ingestion: ${metrics.memoryUsageMB}MB`,
        recommendations: [
          'Reduce batch size',
          'Implement memory cleanup',
          'Check for memory leaks',
          'Consider processing in smaller chunks',
        ],
      });
    }
  }

  /**
   * Analyzes error patterns for systemic issues
   */
  private analyzeErrorPatterns(error: Error, context: any): void {
    // This could be enhanced with more sophisticated pattern analysis
    const recentErrors = Array.from(this.auditLogs.values()).filter(log => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return (
        log.timestamp > fiveMinutesAgo &&
        log.result === 'failure' &&
        log.errorMessage?.includes(error.message.substring(0, 50))
      );
    });

    if (recentErrors.length > 3) {
      this.logger.warn('Error pattern detected', {
        event: 'error_pattern',
        errorMessage: error.message,
        occurrences: recentErrors.length,
        timeWindow: '5 minutes',
        context,
      });
    }
  }

  /**
   * Calculates data quality score based on recent metrics
   */
  private calculateDataQualityScore(metrics: IngestionMetrics[]): number {
    if (metrics.length === 0) return 1.0;

    const totalOperations = metrics.reduce(
      (sum, m) => sum + m.candlesFetched,
      0
    );
    const totalErrors = metrics.reduce((sum, m) => sum + m.errorCount, 0);
    const totalDuplicates = metrics.reduce(
      (sum, m) => sum + m.candlesFetched * m.duplicateRate,
      0
    );

    if (totalOperations === 0) return 1.0;

    const errorRate = totalErrors / totalOperations;
    const duplicateRate = totalDuplicates / totalOperations;

    // Simple quality score: 1.0 - (error_rate + duplicate_rate/2)
    return Math.max(0, 1.0 - errorRate - duplicateRate / 2);
  }

  /**
   * Calculates alert severity based on threshold breach
   */
  private calculateSeverity(
    actualValue: number,
    threshold: number
  ): PerformanceAlert['severity'] {
    const ratio = actualValue / threshold;

    if (ratio >= 3) return 'critical';
    if (ratio >= 2) return 'high';
    if (ratio >= 1.5) return 'medium';
    return 'low';
  }

  /**
   * Gets performance threshold for specific operations
   */
  private getPerformanceThreshold(operation: string): number {
    const thresholds: Record<string, number> = {
      broker_fetch: 10000, // 10 seconds
      normalization: 5000, // 5 seconds
      session_filtering: 2000, // 2 seconds
      database_insert: 15000, // 15 seconds
      validation: 3000, // 3 seconds
    };

    return thresholds[operation] || this.config.slowProcessingThresholdMs;
  }

  /**
   * Gets performance recommendations for slow operations
   */
  private getPerformanceRecommendations(
    operation: string,
    durationMs: number
  ): string[] {
    const baseRecommendations: Record<string, string[]> = {
      broker_fetch: [
        'Check broker API status and response times',
        'Verify network connectivity',
        'Consider reducing request size',
        'Check rate limiting settings',
      ],
      normalization: [
        'Optimize data transformation logic',
        'Check for inefficient parsing',
        'Consider batch processing',
        'Profile memory usage',
      ],
      session_filtering: [
        'Optimize filtering logic',
        'Consider pre-filtering at source',
        'Check timezone calculations',
        'Review filter complexity',
      ],
      database_insert: [
        'Check database connection pool',
        'Optimize batch insert size',
        'Review database indexes',
        'Check for lock contention',
      ],
    };

    return (
      baseRecommendations[operation] || [
        'Profile the operation for bottlenecks',
        'Check system resource usage',
        'Consider optimization strategies',
      ]
    );
  }

  /**
   * Gets current memory usage in MB
   */
  private getCurrentMemoryUsage(): number {
    const usage = process.memoryUsage();
    return Math.round(usage.heapUsed / 1024 / 1024);
  }

  /**
   * Gets current CPU usage percentage (simplified)
   */
  private getCurrentCpuUsage(): number {
    // This is a simplified implementation
    // In production, you might want to use a proper CPU monitoring library
    return 0;
  }

  /**
   * Cleans up old metrics based on retention policy
   */
  private cleanupOldMetrics(): void {
    const cutoffDate = new Date(
      Date.now() - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000
    );

    for (const [id, metrics] of this.metrics) {
      if (metrics.timestamp < cutoffDate) {
        this.metrics.delete(id);
      }
    }
  }

  /**
   * Cleans up old audit logs based on retention policy
   */
  private cleanupOldAuditLogs(): void {
    const cutoffDate = new Date(
      Date.now() - this.config.auditLogRetentionDays * 24 * 60 * 60 * 1000
    );

    for (const [id, log] of this.auditLogs) {
      if (log.timestamp < cutoffDate) {
        this.auditLogs.delete(id);
      }
    }
  }

  /**
   * Generates unique metrics ID
   */
  private generateMetricsId(jobId: string): string {
    return `metrics_${jobId}_${Date.now()}`;
  }

  /**
   * Generates unique audit ID
   */
  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
