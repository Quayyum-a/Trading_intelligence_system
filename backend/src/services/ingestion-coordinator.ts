import {
  CandleIngestionService,
  IngestionConfig,
  IngestionResult,
  BackfillResult,
  IncrementalResult,
} from './candle-ingestion.service.js';
import { logger } from '../config/logger.js';

/**
 * Ingestion Coordinator
 *
 * Manages concurrent ingestion processes, handles interruptions,
 * and provides coordination for multiple ingestion operations.
 */

export interface IngestionJob {
  id: string;
  config: IngestionConfig;
  type: 'backfill' | 'incremental';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime?: Date;
  endTime?: Date;
  result?: IngestionResult | BackfillResult | IncrementalResult;
  error?: string;
  priority: number; // Higher number = higher priority
}

export interface CoordinatorConfig {
  maxConcurrentJobs: number;
  jobTimeoutMs: number;
  enableJobQueue: boolean;
  retryFailedJobs: boolean;
  maxRetries: number;
}

export class IngestionCoordinator {
  private config: CoordinatorConfig;
  private ingestionService: CandleIngestionService;
  private activeJobs: Map<string, IngestionJob> = new Map();
  private jobQueue: IngestionJob[] = [];
  private runningPromises: Map<string, Promise<void>> = new Map();
  private isShuttingDown: boolean = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    ingestionService: CandleIngestionService,
    config?: Partial<CoordinatorConfig>
  ) {
    this.ingestionService = ingestionService;
    this.config = {
      maxConcurrentJobs: 3,
      jobTimeoutMs: 30 * 60 * 1000, // 30 minutes
      enableJobQueue: true,
      retryFailedJobs: true,
      maxRetries: 3,
      ...config,
    };

    // Set up graceful shutdown handlers
    this.setupShutdownHandlers();
  }

  /**
   * Submits a backfill job
   */
  async submitBackfillJob(
    config: IngestionConfig,
    fromDate: Date,
    toDate: Date,
    priority: number = 1
  ): Promise<string> {
    const jobId = this.generateJobId('backfill', config);

    const job: IngestionJob = {
      id: jobId,
      config,
      type: 'backfill',
      status: 'pending',
      priority,
    };

    return this.submitJob(job, async () => {
      const maxDaysPerBatch =
        this.ingestionService.getRecommendedBackfillBatchSize(config.timeframe);
      return await this.ingestionService.backfillHistoricalData(
        config,
        fromDate,
        toDate,
        maxDaysPerBatch
      );
    });
  }

  /**
   * Submits an incremental update job
   */
  async submitIncrementalJob(
    config: IngestionConfig,
    priority: number = 2
  ): Promise<string> {
    const jobId = this.generateJobId('incremental', config);

    const job: IngestionJob = {
      id: jobId,
      config,
      type: 'incremental',
      status: 'pending',
      priority,
    };

    return this.submitJob(job, async () => {
      const lookbackHours =
        this.ingestionService.getRecommendedIncrementalLookback(
          config.timeframe
        );
      return await this.ingestionService.smartIncrementalUpdate(config, 7);
    });
  }

  /**
   * Submits a job to the coordinator
   */
  private async submitJob(
    job: IngestionJob,
    executor: () => Promise<
      IngestionResult | BackfillResult | IncrementalResult
    >
  ): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Coordinator is shutting down, cannot accept new jobs');
    }

    // Check for duplicate jobs
    const existingJob = this.findExistingJob(job.config, job.type);
    if (
      existingJob &&
      (existingJob.status === 'pending' || existingJob.status === 'running')
    ) {
      logger.warn('Duplicate job detected, returning existing job ID', {
        existingJobId: existingJob.id,
        newJobId: job.id,
        config: job.config,
      });
      return existingJob.id;
    }

    this.activeJobs.set(job.id, job);

    if (this.canRunImmediately()) {
      this.executeJob(job, executor);
    } else if (this.config.enableJobQueue) {
      this.addToQueue(job, executor);
    } else {
      job.status = 'failed';
      job.error = 'Maximum concurrent jobs reached and queue is disabled';
      logger.error('Job rejected due to concurrency limits', {
        jobId: job.id,
        activeJobs: this.activeJobs.size,
        maxConcurrentJobs: this.config.maxConcurrentJobs,
      });
    }

    logger.info('Job submitted', {
      jobId: job.id,
      type: job.type,
      config: job.config,
      priority: job.priority,
      status: job.status,
    });

    return job.id;
  }

  /**
   * Executes a job
   */
  private executeJob(
    job: IngestionJob,
    executor: () => Promise<
      IngestionResult | BackfillResult | IncrementalResult
    >
  ): void {
    job.status = 'running';
    job.startTime = new Date();

    const jobPromise = this.runJobWithTimeout(job, executor);
    this.runningPromises.set(job.id, jobPromise);

    jobPromise.finally(() => {
      this.runningPromises.delete(job.id);
      this.processQueue();
    });
  }

  /**
   * Runs a job with timeout and error handling
   */
  private async runJobWithTimeout(
    job: IngestionJob,
    executor: () => Promise<
      IngestionResult | BackfillResult | IncrementalResult
    >
  ): Promise<void> {
    try {
      logger.info('Starting job execution', {
        jobId: job.id,
        type: job.type,
        config: job.config,
      });

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Job timeout after ${this.config.jobTimeoutMs}ms`));
        }, this.config.jobTimeoutMs);
      });

      // Race between job execution and timeout
      const result = await Promise.race([executor(), timeoutPromise]);

      job.status = 'completed';
      job.result = result;
      job.endTime = new Date();

      logger.info('Job completed successfully', {
        jobId: job.id,
        type: job.type,
        duration: job.endTime.getTime() - (job.startTime?.getTime() || 0),
        result: {
          totalFetched: result.totalFetched,
          totalInserted: result.totalInserted,
          totalSkipped: result.totalSkipped,
          errors: result.errors.length,
        },
      });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.endTime = new Date();

      logger.error('Job failed', {
        jobId: job.id,
        type: job.type,
        error: job.error,
        duration: job.endTime.getTime() - (job.startTime?.getTime() || 0),
      });

      // Retry logic
      if (this.config.retryFailedJobs && this.shouldRetryJob(job)) {
        this.scheduleRetry(job, executor);
      }
    }
  }

  /**
   * Schedules a job retry
   */
  private scheduleRetry(
    job: IngestionJob,
    executor: () => Promise<
      IngestionResult | BackfillResult | IncrementalResult
    >
  ): void {
    const retryCount = (job as any).retryCount || 0;
    if (retryCount >= this.config.maxRetries) {
      logger.error('Job exceeded maximum retries', {
        jobId: job.id,
        retryCount,
        maxRetries: this.config.maxRetries,
      });
      return;
    }

    (job as any).retryCount = retryCount + 1;
    job.status = 'pending';
    job.error = undefined;

    // Exponential backoff
    const delayMs = Math.min(1000 * Math.pow(2, retryCount), 30000);

    logger.info('Scheduling job retry', {
      jobId: job.id,
      retryCount: retryCount + 1,
      delayMs,
    });

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.addToQueue(job, executor);
      }
    }, delayMs);
  }

  /**
   * Adds a job to the queue
   */
  private addToQueue(
    job: IngestionJob,
    executor: () => Promise<
      IngestionResult | BackfillResult | IncrementalResult
    >
  ): void {
    // Store executor with job for later use
    (job as any).executor = executor;

    // Insert job in priority order
    const insertIndex = this.jobQueue.findIndex(
      queuedJob => queuedJob.priority < job.priority
    );
    if (insertIndex === -1) {
      this.jobQueue.push(job);
    } else {
      this.jobQueue.splice(insertIndex, 0, job);
    }

    logger.debug('Job added to queue', {
      jobId: job.id,
      queuePosition:
        insertIndex === -1 ? this.jobQueue.length : insertIndex + 1,
      queueSize: this.jobQueue.length,
    });
  }

  /**
   * Processes the job queue
   */
  private processQueue(): void {
    while (this.canRunImmediately() && this.jobQueue.length > 0) {
      const job = this.jobQueue.shift()!;
      const executor = (job as any).executor;

      if (executor) {
        this.executeJob(job, executor);
      } else {
        logger.error('Job in queue missing executor', { jobId: job.id });
        job.status = 'failed';
        job.error = 'Missing executor function';
      }
    }
  }

  /**
   * Checks if a job can run immediately
   */
  private canRunImmediately(): boolean {
    return (
      this.runningPromises.size < this.config.maxConcurrentJobs &&
      !this.isShuttingDown
    );
  }

  /**
   * Finds an existing job with the same configuration
   */
  private findExistingJob(
    config: IngestionConfig,
    type: string
  ): IngestionJob | undefined {
    for (const job of this.activeJobs.values()) {
      if (
        job.type === type &&
        job.config.pair === config.pair &&
        job.config.timeframe === config.timeframe
      ) {
        return job;
      }
    }
    return undefined;
  }

  /**
   * Determines if a job should be retried
   */
  private shouldRetryJob(job: IngestionJob): boolean {
    // Don't retry authentication errors or configuration errors
    if (
      job.error?.includes('authentication') ||
      job.error?.includes('configuration') ||
      job.error?.includes('validation')
    ) {
      return false;
    }

    return true;
  }

  /**
   * Generates a unique job ID
   */
  private generateJobId(type: string, config: IngestionConfig): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${type}-${config.pair}-${config.timeframe}-${timestamp}-${random}`;
  }

  /**
   * Gets job status
   */
  getJobStatus(jobId: string): IngestionJob | undefined {
    return this.activeJobs.get(jobId);
  }

  /**
   * Gets all active jobs
   */
  getAllJobs(): IngestionJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Cancels a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'running') {
      // For running jobs, we can't easily cancel them, but we mark them as cancelled
      job.status = 'cancelled';
      logger.info('Job marked for cancellation', { jobId });
      return true;
    } else if (job.status === 'pending') {
      // Remove from queue
      const queueIndex = this.jobQueue.findIndex(
        queuedJob => queuedJob.id === jobId
      );
      if (queueIndex !== -1) {
        this.jobQueue.splice(queueIndex, 1);
      }

      job.status = 'cancelled';
      job.endTime = new Date();
      logger.info('Job cancelled', { jobId });
      return true;
    }

    return false;
  }

  /**
   * Sets up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info('Received shutdown signal, initiating graceful shutdown', {
        signal,
      });
      await this.gracefulShutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Performs graceful shutdown
   */
  async gracefulShutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;

    this.shutdownPromise = (async () => {
      logger.info('Starting graceful shutdown', {
        activeJobs: this.activeJobs.size,
        runningJobs: this.runningPromises.size,
        queuedJobs: this.jobQueue.length,
      });

      // Cancel all queued jobs
      for (const job of this.jobQueue) {
        job.status = 'cancelled';
        job.endTime = new Date();
      }
      this.jobQueue.length = 0;

      // Wait for running jobs to complete (with timeout)
      if (this.runningPromises.size > 0) {
        logger.info('Waiting for running jobs to complete', {
          runningJobs: this.runningPromises.size,
        });

        const shutdownTimeout = 60000; // 60 seconds
        const runningPromises = Array.from(this.runningPromises.values());

        try {
          await Promise.race([
            Promise.all(runningPromises),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Shutdown timeout')),
                shutdownTimeout
              )
            ),
          ]);

          logger.info('All running jobs completed during shutdown');
        } catch (error) {
          logger.warn(
            'Shutdown timeout reached, some jobs may not have completed',
            {
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }

      logger.info('Graceful shutdown completed');
    })();

    return this.shutdownPromise;
  }
}
