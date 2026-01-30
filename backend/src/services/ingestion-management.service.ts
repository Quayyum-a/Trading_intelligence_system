import { BaseRepository } from '../repositories/base.repository.js';
import {
  CandleIngestionService,
  IngestionConfig,
  IngestionResult,
  BackfillResult,
  IncrementalResult,
} from './candle-ingestion.service.js';
import { BrokerFactory } from '../brokers/broker-factory.js';
import { logger } from '../config/logger.js';

export interface IngestionJob {
  id: string;
  pair: string;
  timeframe: string;
  mode: 'backfill' | 'incremental';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  config: IngestionConfig;
  startDate?: Date;
  endDate?: Date;
  lastProcessedTimestamp?: Date;
  result?: IngestionResult | BackfillResult | IncrementalResult;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  progress?: IngestionProgress;
}

export interface IngestionProgress {
  currentPhase:
    | 'fetching'
    | 'normalizing'
    | 'filtering'
    | 'storing'
    | 'completed';
  totalBatches?: number;
  completedBatches?: number;
  currentBatch?: number;
  estimatedCompletionTime?: Date;
  processingRate?: number; // candles per minute
}

export interface IngestionJobRequest {
  pair: string;
  timeframe: string;
  mode: 'backfill' | 'incremental';
  brokerName?: string;
  enableSessionFiltering?: boolean;
  startDate?: Date;
  endDate?: Date;
  batchSize?: number;
  maxRetries?: number;
  priority?: number;
}

export interface IngestionSchedule {
  id: string;
  pair: string;
  timeframe: string;
  mode: 'incremental';
  cronExpression: string;
  enabled: boolean;
  config: IngestionConfig;
  lastRunAt?: Date;
  nextRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IngestionStats {
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalCandlesIngested: number;
  averageProcessingTime: number;
  lastSuccessfulRun?: Date;
  systemHealth: 'healthy' | 'degraded' | 'critical';
}

export interface BrokerConfiguration {
  name: string;
  type: 'oanda' | 'fxcm';
  enabled: boolean;
  config: Record<string, any>;
  rateLimitPerMinute: number;
  maxConcurrentJobs: number;
  healthCheckInterval: number;
  lastHealthCheck?: Date;
  isHealthy: boolean;
}

export interface IngestionAlert {
  id: string;
  type: 'job_failed' | 'broker_unhealthy' | 'data_gap' | 'high_error_rate';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, any>;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

export class IngestionManagementService extends BaseRepository {
  private jobs: Map<string, IngestionJob> = new Map();
  private schedules: Map<string, IngestionSchedule> = new Map();
  private brokerConfigs: Map<string, BrokerConfiguration> = new Map();
  private alerts: Map<string, IngestionAlert> = new Map();
  private runningJobs: Set<string> = new Set();
  private jobQueue: IngestionJob[] = [];
  private maxConcurrentJobs: number = 3;
  private isProcessingQueue: boolean = false;

  constructor() {
    super();
    this.initializeDefaultConfigurations();
  }

  /**
   * Creates a new ingestion job
   * Requirements: 6.1, 6.2
   */
  async createIngestionJob(
    request: IngestionJobRequest
  ): Promise<IngestionJob> {
    try {
      this.validateJobRequest(request);

      const jobId = this.generateJobId();
      const now = new Date();

      const config: IngestionConfig = {
        pair: request.pair,
        timeframe: request.timeframe,
        brokerName: request.brokerName || 'default',
        enableSessionFiltering: request.enableSessionFiltering ?? true,
        batchSize:
          request.batchSize ?? this.getRecommendedBatchSize(request.timeframe),
        maxRetries: request.maxRetries ?? 3,
      };

      const job: IngestionJob = {
        id: jobId,
        pair: request.pair,
        timeframe: request.timeframe,
        mode: request.mode,
        status: 'pending',
        config,
        startDate: request.startDate,
        endDate: request.endDate,
        createdAt: now,
        updatedAt: now,
        progress: {
          currentPhase: 'fetching',
          totalBatches: 0,
          completedBatches: 0,
          currentBatch: 0,
        },
      };

      this.jobs.set(jobId, job);
      this.jobQueue.push(job);

      logger.info('Ingestion job created', {
        jobId,
        pair: request.pair,
        timeframe: request.timeframe,
        mode: request.mode,
        brokerName: config.brokerName,
      });

      // Start processing queue if not already running
      if (!this.isProcessingQueue) {
        this.processJobQueue();
      }

      return job;
    } catch (error) {
      this.handleDatabaseError(error, 'create ingestion job');
    }
  }

  /**
   * Gets job status and details
   */
  getJob(jobId: string): IngestionJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Lists all jobs with optional filtering
   */
  listJobs(filter?: {
    status?: IngestionJob['status'];
    pair?: string;
    timeframe?: string;
    mode?: IngestionJob['mode'];
    limit?: number;
  }): IngestionJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter) {
      if (filter.status) {
        jobs = jobs.filter(job => job.status === filter.status);
      }
      if (filter.pair) {
        jobs = jobs.filter(job => job.pair === filter.pair);
      }
      if (filter.timeframe) {
        jobs = jobs.filter(job => job.timeframe === filter.timeframe);
      }
      if (filter.mode) {
        jobs = jobs.filter(job => job.mode === filter.mode);
      }
      if (filter.limit) {
        jobs = jobs.slice(0, filter.limit);
      }
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancels a pending or running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn('Attempted to cancel non-existent job', { jobId });
      return false;
    }

    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      logger.warn('Attempted to cancel job in final state', {
        jobId,
        status: job.status,
      });
      return false;
    }

    // Remove from queue if pending
    if (job.status === 'pending') {
      const queueIndex = this.jobQueue.findIndex(
        queuedJob => queuedJob.id === jobId
      );
      if (queueIndex !== -1) {
        this.jobQueue.splice(queueIndex, 1);
      }
    }

    // Update job status
    job.status = 'cancelled';
    job.updatedAt = new Date();
    job.completedAt = new Date();

    // Remove from running jobs
    this.runningJobs.delete(jobId);

    logger.info('Job cancelled', {
      jobId,
      pair: job.pair,
      timeframe: job.timeframe,
    });
    return true;
  }

  /**
   * Processes the job queue
   */
  private async processJobQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (
        this.jobQueue.length > 0 &&
        this.runningJobs.size < this.maxConcurrentJobs
      ) {
        const job = this.jobQueue.shift();
        if (!job || job.status !== 'pending') {
          continue;
        }

        // Start processing the job
        this.runningJobs.add(job.id);
        this.processJob(job).catch(error => {
          logger.error('Job processing failed', {
            jobId: job.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }
    } finally {
      this.isProcessingQueue = false;
    }

    // Schedule next queue processing if there are pending jobs
    if (this.jobQueue.length > 0) {
      setTimeout(() => this.processJobQueue(), 5000); // Check again in 5 seconds
    }
  }

  /**
   * Processes a single job
   */
  private async processJob(job: IngestionJob): Promise<void> {
    try {
      // Update job status
      job.status = 'running';
      job.startedAt = new Date();
      job.updatedAt = new Date();

      logger.info('Starting job processing', {
        jobId: job.id,
        pair: job.pair,
        timeframe: job.timeframe,
        mode: job.mode,
      });

      // Create ingestion service with appropriate broker
      const broker = BrokerFactory.createBroker(
        job.config.brokerName || 'default'
      );
      const ingestionService = new CandleIngestionService(broker);

      let result: IngestionResult | BackfillResult | IncrementalResult;

      // Execute based on job mode
      if (job.mode === 'backfill') {
        if (!job.startDate || !job.endDate) {
          throw new Error('Backfill jobs require startDate and endDate');
        }

        result = await ingestionService.backfillHistoricalData(
          job.config,
          job.startDate,
          job.endDate
        );
      } else {
        result = await ingestionService.updateIncremental(job.config);
      }

      // Update job with results
      job.result = result;
      job.lastProcessedTimestamp = result.lastProcessedTimestamp;
      job.status = result.errors.length > 0 ? 'completed' : 'completed';
      job.completedAt = new Date();
      job.updatedAt = new Date();

      logger.info('Job completed successfully', {
        jobId: job.id,
        pair: job.pair,
        timeframe: job.timeframe,
        mode: job.mode,
        result: {
          totalFetched: result.totalFetched,
          totalInserted: result.totalInserted,
          totalSkipped: result.totalSkipped,
          errors: result.errors.length,
          processingTimeMs: result.processingTimeMs,
        },
      });
    } catch (error) {
      // Update job with error
      job.status = 'failed';
      job.errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      job.updatedAt = new Date();

      logger.error('Job failed', {
        jobId: job.id,
        pair: job.pair,
        timeframe: job.timeframe,
        mode: job.mode,
        error: job.errorMessage,
      });

      // Create alert for failed job
      await this.createAlert({
        type: 'job_failed',
        severity: 'medium',
        message: `Ingestion job failed: ${job.pair} ${job.timeframe}`,
        details: {
          jobId: job.id,
          pair: job.pair,
          timeframe: job.timeframe,
          mode: job.mode,
          error: job.errorMessage,
        },
      });
    } finally {
      // Remove from running jobs
      this.runningJobs.delete(job.id);

      // Continue processing queue
      setTimeout(() => this.processJobQueue(), 1000);
    }
  }

  /**
   * Creates and manages broker configurations
   * Requirements: 8.1, 8.2
   */
  setBrokerConfiguration(config: BrokerConfiguration): void {
    this.validateBrokerConfiguration(config);

    this.brokerConfigs.set(config.name, {
      ...config,
      lastHealthCheck: new Date(),
      isHealthy: true,
    });

    logger.info('Broker configuration updated', {
      brokerName: config.name,
      type: config.type,
      enabled: config.enabled,
    });
  }

  /**
   * Gets broker configuration
   */
  getBrokerConfiguration(brokerName: string): BrokerConfiguration | null {
    return this.brokerConfigs.get(brokerName) || null;
  }

  /**
   * Lists all broker configurations
   */
  listBrokerConfigurations(): BrokerConfiguration[] {
    return Array.from(this.brokerConfigs.values());
  }

  /**
   * Creates an ingestion schedule for automated runs
   */
  createSchedule(
    schedule: Omit<IngestionSchedule, 'id' | 'createdAt' | 'updatedAt'>
  ): IngestionSchedule {
    const scheduleId = this.generateScheduleId();
    const now = new Date();

    const newSchedule: IngestionSchedule = {
      ...schedule,
      id: scheduleId,
      createdAt: now,
      updatedAt: now,
      nextRunAt: this.calculateNextRun(schedule.cronExpression),
    };

    this.schedules.set(scheduleId, newSchedule);

    logger.info('Ingestion schedule created', {
      scheduleId,
      pair: schedule.pair,
      timeframe: schedule.timeframe,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });

    return newSchedule;
  }

  /**
   * Gets ingestion statistics
   */
  getIngestionStats(): IngestionStats {
    const jobs = Array.from(this.jobs.values());

    const totalJobs = jobs.length;
    const runningJobs = jobs.filter(job => job.status === 'running').length;
    const completedJobs = jobs.filter(job => job.status === 'completed').length;
    const failedJobs = jobs.filter(job => job.status === 'failed').length;

    const completedJobsWithResults = jobs.filter(
      job => job.status === 'completed' && job.result
    );

    const totalCandlesIngested = completedJobsWithResults.reduce(
      (total, job) => total + (job.result?.totalInserted || 0),
      0
    );

    const averageProcessingTime =
      completedJobsWithResults.length > 0
        ? completedJobsWithResults.reduce(
            (total, job) => total + (job.result?.processingTimeMs || 0),
            0
          ) / completedJobsWithResults.length
        : 0;

    const lastSuccessfulRun = completedJobsWithResults.sort(
      (a, b) =>
        (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
    )[0]?.completedAt;

    // Determine system health
    let systemHealth: IngestionStats['systemHealth'] = 'healthy';
    const recentFailureRate = this.calculateRecentFailureRate();

    if (recentFailureRate > 0.5) {
      systemHealth = 'critical';
    } else if (
      recentFailureRate > 0.2 ||
      runningJobs > this.maxConcurrentJobs
    ) {
      systemHealth = 'degraded';
    }

    return {
      totalJobs,
      runningJobs,
      completedJobs,
      failedJobs,
      totalCandlesIngested,
      averageProcessingTime,
      lastSuccessfulRun,
      systemHealth,
    };
  }

  /**
   * Creates monitoring alerts
   */
  private async createAlert(
    alertData: Omit<IngestionAlert, 'id' | 'createdAt'>
  ): Promise<IngestionAlert> {
    const alertId = this.generateAlertId();
    const alert: IngestionAlert = {
      ...alertData,
      id: alertId,
      createdAt: new Date(),
    };

    this.alerts.set(alertId, alert);

    logger.warn('Alert created', {
      alertId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
    });

    return alert;
  }

  /**
   * Gets unresolved alerts
   */
  getActiveAlerts(): IngestionAlert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolvedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Acknowledges an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.acknowledgedAt) {
      return false;
    }

    alert.acknowledgedAt = new Date();
    logger.info('Alert acknowledged', { alertId });
    return true;
  }

  /**
   * Resolves an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolvedAt) {
      return false;
    }

    alert.resolvedAt = new Date();
    logger.info('Alert resolved', { alertId });
    return true;
  }

  /**
   * Performs health checks on brokers
   */
  async performBrokerHealthChecks(): Promise<void> {
    const brokers = Array.from(this.brokerConfigs.values());

    for (const brokerConfig of brokers) {
      if (!brokerConfig.enabled) {
        continue;
      }

      try {
        const broker = BrokerFactory.createBroker(brokerConfig.name);
        const isHealthy = await broker.validateConnection();

        brokerConfig.isHealthy = isHealthy;
        brokerConfig.lastHealthCheck = new Date();

        if (!isHealthy) {
          await this.createAlert({
            type: 'broker_unhealthy',
            severity: 'high',
            message: `Broker ${brokerConfig.name} health check failed`,
            details: {
              brokerName: brokerConfig.name,
              brokerType: brokerConfig.type,
              lastHealthCheck: brokerConfig.lastHealthCheck,
            },
          });
        }

        logger.debug('Broker health check completed', {
          brokerName: brokerConfig.name,
          isHealthy,
          lastHealthCheck: brokerConfig.lastHealthCheck,
        });
      } catch (error) {
        brokerConfig.isHealthy = false;
        brokerConfig.lastHealthCheck = new Date();

        logger.error('Broker health check failed', {
          brokerName: brokerConfig.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Validates job request
   */
  private validateJobRequest(request: IngestionJobRequest): void {
    if (!request.pair || !request.timeframe || !request.mode) {
      throw new Error('Missing required fields: pair, timeframe, mode');
    }

    if (
      request.mode === 'backfill' &&
      (!request.startDate || !request.endDate)
    ) {
      throw new Error('Backfill jobs require startDate and endDate');
    }

    if (
      request.startDate &&
      request.endDate &&
      request.startDate >= request.endDate
    ) {
      throw new Error('startDate must be before endDate');
    }
  }

  /**
   * Validates broker configuration
   */
  private validateBrokerConfiguration(config: BrokerConfiguration): void {
    if (!config.name || !config.type) {
      throw new Error('Broker configuration must have name and type');
    }

    if (!['oanda', 'fxcm'].includes(config.type)) {
      throw new Error('Broker type must be oanda or fxcm');
    }

    if (config.rateLimitPerMinute <= 0 || config.maxConcurrentJobs <= 0) {
      throw new Error('Rate limits and concurrent job limits must be positive');
    }
  }

  /**
   * Initializes default configurations
   */
  private initializeDefaultConfigurations(): void {
    // Set up default broker configurations
    this.setBrokerConfiguration({
      name: 'default',
      type: 'oanda',
      enabled: true,
      config: {},
      rateLimitPerMinute: 60,
      maxConcurrentJobs: 2,
      healthCheckInterval: 300000, // 5 minutes
      isHealthy: true,
    });

    logger.info('Default configurations initialized');
  }

  /**
   * Calculates recent failure rate for system health
   */
  private calculateRecentFailureRate(): number {
    const recentJobs = Array.from(this.jobs.values()).filter(job => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return (
        job.createdAt > oneDayAgo &&
        (job.status === 'completed' || job.status === 'failed')
      );
    });

    if (recentJobs.length === 0) {
      return 0;
    }

    const failedJobs = recentJobs.filter(job => job.status === 'failed').length;
    return failedJobs / recentJobs.length;
  }

  /**
   * Gets recommended batch size based on timeframe
   */
  private getRecommendedBatchSize(timeframe: string): number {
    const batchSizes: Record<string, number> = {
      '1m': 1000,
      '5m': 2000,
      '15m': 5000,
      '30m': 5000,
      '1h': 5000,
      '4h': 5000,
      '1d': 5000,
    };

    return batchSizes[timeframe] || 5000;
  }

  /**
   * Calculates next run time for cron expression
   */
  private calculateNextRun(cronExpression: string): Date {
    // Simple implementation - in production, use a proper cron parser
    // For now, assume it's a simple interval in minutes
    const intervalMatch = cronExpression.match(/^\*\/(\d+) \* \* \* \*$/);
    if (intervalMatch) {
      const intervalMinutes = parseInt(intervalMatch[1], 10);
      return new Date(Date.now() + intervalMinutes * 60 * 1000);
    }

    // Default to 15 minutes from now
    return new Date(Date.now() + 15 * 60 * 1000);
  }

  /**
   * Generates unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates unique schedule ID
   */
  private generateScheduleId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sets maximum concurrent jobs
   */
  setMaxConcurrentJobs(maxJobs: number): void {
    if (maxJobs <= 0) {
      throw new Error('Max concurrent jobs must be positive');
    }

    this.maxConcurrentJobs = maxJobs;
    logger.info('Max concurrent jobs updated', { maxConcurrentJobs: maxJobs });
  }

  /**
   * Gets current queue status
   */
  getQueueStatus(): {
    pendingJobs: number;
    runningJobs: number;
    maxConcurrentJobs: number;
    isProcessingQueue: boolean;
  } {
    return {
      pendingJobs: this.jobQueue.length,
      runningJobs: this.runningJobs.size,
      maxConcurrentJobs: this.maxConcurrentJobs,
      isProcessingQueue: this.isProcessingQueue,
    };
  }
}
