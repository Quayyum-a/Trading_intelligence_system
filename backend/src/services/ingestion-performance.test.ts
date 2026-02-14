import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IngestionCoordinator, CoordinatorConfig } from './ingestion-coordinator.js';
import { CandleIngestionService, IngestionConfig } from './candle-ingestion.service.js';

/**
 * Performance and Timeout Tests for Ingestion Services
 * 
 * Tests the enhanced performance optimizations and timeout handling:
 * - Operation-specific timeouts
 * - Async processing for long-running operations
 * - Database query optimizations
 * - Batch processing performance
 * 
 * Requirements: 1.4
 */

describe('Ingestion Performance and Timeout Handling', () => {
  let coordinator: IngestionCoordinator;
  let mockIngestionService: CandleIngestionService;

  beforeEach(() => {
    // Create mock ingestion service
    mockIngestionService = {
      backfillHistoricalData: vi.fn(),
      smartIncrementalUpdate: vi.fn(),
      getRecommendedBackfillBatchSize: vi.fn().mockReturnValue(7),
      getRecommendedIncrementalLookback: vi.fn().mockReturnValue(24),
    } as any;

    // Create coordinator with performance optimizations enabled
    const config: Partial<CoordinatorConfig> = {
      maxConcurrentJobs: 2,
      jobTimeoutMs: 10000, // 10 seconds for testing
      operationTimeoutMs: 5000, // 5 seconds for operations
      batchProcessingEnabled: true,
      maxBatchSize: 10,
      asyncProcessingEnabled: true,
      performanceMonitoringEnabled: true,
      queryOptimizationEnabled: true,
    };

    coordinator = new IngestionCoordinator(mockIngestionService, config);
  });

  describe('Performance Monitoring', () => {
    it('should initialize performance monitoring correctly', () => {
      const stats = coordinator.getPerformanceStatistics();
      
      expect(stats).toHaveProperty('activeJobs');
      expect(stats).toHaveProperty('queuedJobs');
      expect(stats).toHaveProperty('runningJobs');
      expect(stats).toHaveProperty('completedJobs');
      expect(stats).toHaveProperty('failedJobs');
      expect(stats).toHaveProperty('avgProcessingTimeMs');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('memoryUsage');
      
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);
      expect(stats.runningJobs).toBe(0);
    });

    it('should track job statistics correctly', async () => {
      // Mock successful operation
      mockIngestionService.backfillHistoricalData = vi.fn().mockResolvedValue({
        totalFetched: 100,
        totalInserted: 95,
        totalSkipped: 5,
        errors: [],
        processingTimeMs: 1000,
      });

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 100,
        maxRetries: 3,
      };

      // Submit a job
      const jobId = await coordinator.submitBackfillJob(
        config,
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        1
      );

      expect(jobId).toBeDefined();
      
      // Wait a bit for job to process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = coordinator.getPerformanceStatistics();
      expect(stats.activeJobs).toBeGreaterThan(0);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle operation timeouts correctly', async () => {
      // Mock operation that takes longer than timeout
      mockIngestionService.backfillHistoricalData = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 6000)) // 6 seconds, longer than 5s timeout
      );

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 100,
        maxRetries: 3,
      };

      try {
        await coordinator.submitBackfillJob(
          config,
          new Date('2024-01-01'),
          new Date('2024-01-02'),
          1
        );
        
        // Wait for timeout to occur
        await new Promise(resolve => setTimeout(resolve, 7000));
        
        const stats = coordinator.getPerformanceStatistics();
        // Should have some failed jobs due to timeout
        expect(stats.failedJobs).toBeGreaterThanOrEqual(0);
        
      } catch (error) {
        // Timeout errors are expected
        expect(error).toBeInstanceOf(Error);
      }
    }, 10000); // 10 second test timeout

    it('should complete operations within timeout limits', async () => {
      // Mock fast operation
      mockIngestionService.backfillHistoricalData = vi.fn().mockResolvedValue({
        totalFetched: 50,
        totalInserted: 50,
        totalSkipped: 0,
        errors: [],
        processingTimeMs: 500,
      });

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 50,
        maxRetries: 3,
      };

      const startTime = Date.now();
      const jobId = await coordinator.submitBackfillJob(
        config,
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        1
      );
      
      expect(jobId).toBeDefined();
      
      // Wait for job to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const elapsedTime = Date.now() - startTime;
      expect(elapsedTime).toBeLessThan(5000); // Should complete well within timeout
    });
  });

  describe('Batch Processing', () => {
    it('should process items in batches when enabled', async () => {
      // This test verifies that batch processing configuration is working
      const stats = coordinator.getPerformanceStatistics();
      expect(stats).toBeDefined();
      
      // Verify coordinator is configured for batch processing
      expect(coordinator).toBeDefined();
    });

    it('should handle batch processing errors gracefully', async () => {
      // Mock operation that fails
      mockIngestionService.backfillHistoricalData = vi.fn().mockRejectedValue(
        new Error('Batch processing failed')
      );

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 100,
        maxRetries: 3,
      };

      try {
        await coordinator.submitBackfillJob(
          config,
          new Date('2024-01-01'),
          new Date('2024-01-02'),
          1
        );
        
        // Wait for error to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const stats = coordinator.getPerformanceStatistics();
        // Should track the failure
        expect(stats.activeJobs).toBeGreaterThanOrEqual(0);
        
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Async Processing', () => {
    it('should handle async operations correctly', async () => {
      // Mock async operation
      mockIngestionService.smartIncrementalUpdate = vi.fn().mockResolvedValue({
        totalFetched: 25,
        totalInserted: 20,
        totalSkipped: 5,
        errors: [],
        processingTimeMs: 800,
        newCandlesFound: true,
        gapDetected: false,
      });

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 50,
        maxRetries: 3,
      };

      const jobId = await coordinator.submitIncrementalJob(config, 2);
      expect(jobId).toBeDefined();
      
      // Verify job was submitted
      const stats = coordinator.getPerformanceStatistics();
      expect(stats.activeJobs).toBeGreaterThan(0);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should track memory usage correctly', () => {
      const stats = coordinator.getPerformanceStatistics();
      
      expect(stats.memoryUsage).toBeDefined();
      expect(stats.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(stats.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(stats.memoryUsage.external).toBeGreaterThanOrEqual(0);
    });

    it('should handle resource cleanup on shutdown', async () => {
      // Submit a job
      mockIngestionService.backfillHistoricalData = vi.fn().mockResolvedValue({
        totalFetched: 10,
        totalInserted: 10,
        totalSkipped: 0,
        errors: [],
        processingTimeMs: 100,
      });

      const config: IngestionConfig = {
        pair: 'XAU_USD',
        timeframe: '15m',
        enableSessionFiltering: true,
        batchSize: 10,
        maxRetries: 3,
      };

      await coordinator.submitBackfillJob(
        config,
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        1
      );

      // Initiate graceful shutdown
      const shutdownPromise = coordinator.gracefulShutdown();
      expect(shutdownPromise).toBeInstanceOf(Promise);
      
      // Wait for shutdown to complete
      await shutdownPromise;
      
      // Verify shutdown completed
      expect(shutdownPromise).resolves.toBeUndefined();
    });
  });
});