import { getLogger } from '../config/logger.js';
import type { IngestionJob } from '../services/ingestion-management.service.js';
import type {
  IngestionResult,
  BackfillResult,
  IncrementalResult,
} from '../services/candle-ingestion.service.js';

export interface IngestionLogContext {
  jobId?: string;
  pair?: string;
  timeframe?: string;
  broker?: string;
  operation?: string;
  phase?: string;
  batchNumber?: number;
  totalBatches?: number;
  requestId?: string;
  correlationId?: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  event: string;
  message: string;
  context: IngestionLogContext;
  metrics?: Record<string, number>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Enhanced logger for ingestion operations with structured logging
 * Requirements: 4.3, 5.5, 7.5
 */
export class IngestionLogger {
  private logger = getLogger();
  private defaultContext: IngestionLogContext;

  constructor(defaultContext: IngestionLogContext = {}) {
    this.defaultContext = defaultContext;
  }

  /**
   * Creates a child logger with additional context
   */
  child(context: IngestionLogContext): IngestionLogger {
    return new IngestionLogger({
      ...this.defaultContext,
      ...context,
    });
  }

  /**
   * Logs job lifecycle events
   */
  logJobEvent(
    event:
      | 'job_created'
      | 'job_started'
      | 'job_completed'
      | 'job_failed'
      | 'job_cancelled',
    job: IngestionJob,
    additionalContext?: Record<string, any>
  ): void {
    const context: IngestionLogContext = {
      ...this.defaultContext,
      jobId: job.id,
      pair: job.pair,
      timeframe: job.timeframe,
      operation: job.mode,
    };

    const logData = {
      event,
      jobId: job.id,
      pair: job.pair,
      timeframe: job.timeframe,
      mode: job.mode,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      errorMessage: job.errorMessage,
      context,
      ...additionalContext,
    };

    switch (event) {
      case 'job_created':
        this.logger.info(
          logData,
          `Ingestion job created: ${job.pair} ${job.timeframe} (${job.mode})`
        );
        break;
      case 'job_started':
        this.logger.info(
          logData,
          `Ingestion job started: ${job.pair} ${job.timeframe} (${job.mode})`
        );
        break;
      case 'job_completed':
        this.logger.info(
          logData,
          `Ingestion job completed: ${job.pair} ${job.timeframe} (${job.mode})`
        );
        break;
      case 'job_failed':
        this.logger.error(
          logData,
          `Ingestion job failed: ${job.pair} ${job.timeframe} (${job.mode})`
        );
        break;
      case 'job_cancelled':
        this.logger.warn(
          logData,
          `Ingestion job cancelled: ${job.pair} ${job.timeframe} (${job.mode})`
        );
        break;
    }
  }

  /**
   * Logs ingestion results with detailed metrics
   */
  logIngestionResult(
    job: IngestionJob,
    result: IngestionResult | BackfillResult | IncrementalResult,
    brokerName: string
  ): void {
    const context: IngestionLogContext = {
      ...this.defaultContext,
      jobId: job.id,
      pair: job.pair,
      timeframe: job.timeframe,
      broker: brokerName,
      operation: job.mode,
    };

    const metrics = {
      processingTimeMs: result.processingTimeMs,
      totalFetched: result.totalFetched,
      totalNormalized: result.totalNormalized,
      totalFiltered: result.totalFiltered,
      totalInserted: result.totalInserted,
      totalSkipped: result.totalSkipped,
      errorCount: result.errors.length,
      fetchRate:
        result.processingTimeMs > 0
          ? Math.round(
              (result.totalFetched / (result.processingTimeMs / 1000)) * 100
            ) / 100
          : 0,
      insertRate:
        result.processingTimeMs > 0
          ? Math.round(
              (result.totalInserted / (result.processingTimeMs / 1000)) * 100
            ) / 100
          : 0,
      errorRate:
        result.totalFetched > 0
          ? Math.round((result.errors.length / result.totalFetched) * 10000) /
            10000
          : 0,
      duplicateRate:
        result.totalFetched > 0
          ? Math.round((result.totalSkipped / result.totalFetched) * 10000) /
            10000
          : 0,
    };

    // Add mode-specific metrics
    if ('batchesProcessed' in result) {
      (metrics as any).batchesProcessed = result.batchesProcessed;
      (metrics as any).averageBatchTimeMs = result.averageBatchTimeMs;
    }

    if ('gapDetected' in result) {
      (metrics as any).gapDetected = result.gapDetected;
      (metrics as any).newCandlesFound = result.newCandlesFound;
    }

    const logData = {
      event: 'ingestion_result',
      jobId: job.id,
      pair: job.pair,
      timeframe: job.timeframe,
      broker: brokerName,
      operation: job.mode,
      context,
      metrics,
      lastProcessedTimestamp: result.lastProcessedTimestamp?.toISOString(),
      errors: result.errors,
    };

    if (result.errors.length > 0) {
      this.logger.warn(
        logData,
        `Ingestion completed with errors: ${job.pair} ${job.timeframe} - ` +
          `${result.totalInserted} inserted, ${result.errors.length} errors`
      );
    } else {
      this.logger.info(
        logData,
        `Ingestion completed successfully: ${job.pair} ${job.timeframe} - ` +
          `${result.totalInserted} inserted, ${result.totalSkipped} skipped`
      );
    }
  }

  /**
   * Logs broker operations and performance
   */
  logBrokerOperation(
    operation:
      | 'fetch_start'
      | 'fetch_complete'
      | 'fetch_error'
      | 'connection_test',
    brokerName: string,
    context: {
      pair?: string;
      timeframe?: string;
      fromDate?: Date;
      toDate?: Date;
      durationMs?: number;
      candleCount?: number;
      error?: Error;
    }
  ): void {
    const logContext: IngestionLogContext = {
      ...this.defaultContext,
      broker: brokerName,
      pair: context.pair,
      timeframe: context.timeframe,
      operation: 'broker_operation',
    };

    const logData = {
      event: `broker_${operation}`,
      broker: brokerName,
      pair: context.pair,
      timeframe: context.timeframe,
      fromDate: context.fromDate?.toISOString(),
      toDate: context.toDate?.toISOString(),
      durationMs: context.durationMs,
      candleCount: context.candleCount,
      context: logContext,
    };

    switch (operation) {
      case 'fetch_start':
        this.logger.debug(
          logData,
          `Starting broker fetch: ${brokerName} - ${context.pair} ${context.timeframe}`
        );
        break;
      case 'fetch_complete':
        this.logger.info(
          logData,
          `Broker fetch completed: ${brokerName} - ${context.candleCount} candles in ${context.durationMs}ms`
        );
        break;
      case 'fetch_error':
        this.logger.error(
          {
            ...logData,
            error: context.error
              ? {
                  name: context.error.name,
                  message: context.error.message,
                  stack: context.error.stack,
                }
              : undefined,
          },
          `Broker fetch failed: ${brokerName} - ${context.error?.message}`
        );
        break;
      case 'connection_test':
        this.logger.debug(
          logData,
          `Broker connection test: ${brokerName} - ${context.durationMs}ms`
        );
        break;
    }
  }

  /**
   * Logs data processing phases
   */
  logProcessingPhase(
    phase:
      | 'normalization'
      | 'session_filtering'
      | 'validation'
      | 'database_insert',
    status: 'start' | 'complete' | 'error',
    context: {
      inputCount?: number;
      outputCount?: number;
      durationMs?: number;
      error?: Error;
      batchNumber?: number;
      totalBatches?: number;
    }
  ): void {
    const logContext: IngestionLogContext = {
      ...this.defaultContext,
      phase,
      batchNumber: context.batchNumber,
      totalBatches: context.totalBatches,
    };

    const logData = {
      event: `${phase}_${status}`,
      phase,
      status,
      inputCount: context.inputCount,
      outputCount: context.outputCount,
      durationMs: context.durationMs,
      batchNumber: context.batchNumber,
      totalBatches: context.totalBatches,
      context: logContext,
    };

    const phaseLabel = phase.replace('_', ' ');

    switch (status) {
      case 'start':
        this.logger.debug(
          logData,
          `Starting ${phaseLabel}${context.batchNumber ? ` (batch ${context.batchNumber}/${context.totalBatches})` : ''}`
        );
        break;
      case 'complete':
        this.logger.debug(
          logData,
          `Completed ${phaseLabel}: ${context.inputCount} → ${context.outputCount} in ${context.durationMs}ms`
        );
        break;
      case 'error':
        this.logger.error(
          {
            ...logData,
            error: context.error
              ? {
                  name: context.error.name,
                  message: context.error.message,
                  stack: context.error.stack,
                }
              : undefined,
          },
          `${phaseLabel} failed: ${context.error?.message}`
        );
        break;
    }
  }

  /**
   * Logs duplicate candle handling
   */
  logDuplicateHandling(
    action: 'detected' | 'skipped' | 'resolved',
    context: {
      pair: string;
      timeframe: string;
      timestamp: Date;
      duplicateCount?: number;
      resolution?: string;
    }
  ): void {
    const logContext: IngestionLogContext = {
      ...this.defaultContext,
      pair: context.pair,
      timeframe: context.timeframe,
      operation: 'duplicate_handling',
    };

    const logData = {
      event: `duplicate_${action}`,
      pair: context.pair,
      timeframe: context.timeframe,
      timestamp: context.timestamp.toISOString(),
      duplicateCount: context.duplicateCount,
      resolution: context.resolution,
      context: logContext,
    };

    switch (action) {
      case 'detected':
        this.logger.info(
          logData,
          `Duplicate candle detected: ${context.pair} ${context.timeframe} at ${context.timestamp.toISOString()}`
        );
        break;
      case 'skipped':
        this.logger.debug(
          logData,
          `Duplicate candle skipped: ${context.pair} ${context.timeframe} at ${context.timestamp.toISOString()}`
        );
        break;
      case 'resolved':
        this.logger.info(
          logData,
          `Duplicate candle resolved: ${context.pair} ${context.timeframe} - ${context.resolution}`
        );
        break;
    }
  }

  /**
   * Logs data quality issues
   */
  logDataQualityIssue(
    issueType:
      | 'gap_detected'
      | 'ohlc_violation'
      | 'invalid_timestamp'
      | 'negative_price'
      | 'negative_volume',
    context: {
      pair: string;
      timeframe: string;
      timestamp?: Date;
      expectedValue?: number;
      actualValue?: number;
      gapDuration?: number;
      details?: Record<string, any>;
    }
  ): void {
    const logContext: IngestionLogContext = {
      ...this.defaultContext,
      pair: context.pair,
      timeframe: context.timeframe,
      operation: 'data_quality',
    };

    const logData = {
      event: `data_quality_${issueType}`,
      issueType,
      pair: context.pair,
      timeframe: context.timeframe,
      timestamp: context.timestamp?.toISOString(),
      expectedValue: context.expectedValue,
      actualValue: context.actualValue,
      gapDuration: context.gapDuration,
      details: context.details,
      context: logContext,
    };

    this.logger.warn(
      logData,
      `Data quality issue detected: ${issueType.replace('_', ' ')} for ${context.pair} ${context.timeframe}`
    );
  }

  /**
   * Logs system performance metrics
   */
  logPerformanceMetrics(metrics: {
    memoryUsageMB: number;
    cpuUsagePercent: number;
    activeConnections: number;
    queueSize: number;
    processingRate: number;
  }): void {
    const logData = {
      event: 'performance_metrics',
      metrics,
      context: this.defaultContext,
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(
      logData,
      `Performance metrics: Memory ${metrics.memoryUsageMB}MB, ` +
        `CPU ${metrics.cpuUsagePercent}%, Queue ${metrics.queueSize}, ` +
        `Rate ${metrics.processingRate} candles/sec`
    );
  }

  /**
   * Logs configuration changes
   */
  logConfigurationChange(
    configType: 'broker' | 'ingestion' | 'monitoring' | 'session_filter',
    action: 'created' | 'updated' | 'deleted',
    configName: string,
    changes: Record<string, any>,
    actor?: string
  ): void {
    const logData = {
      event: 'configuration_change',
      configType,
      action,
      configName,
      changes,
      actor,
      context: this.defaultContext,
      timestamp: new Date().toISOString(),
    };

    this.logger.info(
      logData,
      `Configuration ${action}: ${configType} '${configName}' by ${actor || 'system'}`
    );
  }

  /**
   * Logs alert generation and resolution
   */
  logAlert(
    action: 'created' | 'acknowledged' | 'resolved',
    alertType: string,
    severity: string,
    message: string,
    details?: Record<string, any>
  ): void {
    const logData = {
      event: `alert_${action}`,
      alertType,
      severity,
      message,
      details,
      context: this.defaultContext,
      timestamp: new Date().toISOString(),
    };

    const logLevel =
      severity === 'critical' || severity === 'high'
        ? 'error'
        : severity === 'medium'
          ? 'warn'
          : 'info';

    this.logger[logLevel](
      logData,
      `Alert ${action}: [${severity.toUpperCase()}] ${alertType} - ${message}`
    );
  }

  /**
   * Creates a structured log entry for external systems
   */
  createStructuredLogEntry(
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    message: string,
    context?: IngestionLogContext,
    metrics?: Record<string, number>,
    error?: Error
  ): StructuredLogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      context: { ...this.defaultContext, ...context },
      metrics,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };
  }

  /**
   * Logs raw structured entry
   */
  logStructured(entry: StructuredLogEntry): void {
    const logMethod = this.logger[
      entry.level as keyof typeof this.logger
    ] as Function;
    logMethod.call(this.logger, entry, entry.message);
  }
}
