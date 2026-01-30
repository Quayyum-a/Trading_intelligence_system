import { logger } from '../config/logger.js';

/**
 * Performance Monitor Utility
 * 
 * Provides comprehensive performance monitoring for the ingestion system,
 * including memory usage tracking, execution time measurement, and
 * load testing capabilities.
 */

export interface PerformanceMetrics {
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  executionTime: number;
  throughput: {
    candlesPerSecond: number;
    batchesPerSecond: number;
  };
  systemLoad: {
    cpuUsage?: number;
    activeConnections: number;
    queueSize: number;
  };
}

export interface PerformanceBenchmark {
  operation: string;
  startTime: number;
  endTime?: number;
  memoryBefore: NodeJS.MemoryUsage;
  memoryAfter?: NodeJS.MemoryUsage;
  metadata?: Record<string, any>;
}

export class PerformanceMonitor {
  private benchmarks: Map<string, PerformanceBenchmark> = new Map();
  private metrics: PerformanceMetrics[] = [];
  private maxMetricsHistory = 100;

  /**
   * Starts a performance benchmark
   */
  startBenchmark(operation: string, metadata?: Record<string, any>): string {
    const benchmarkId = `${operation}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const benchmark: PerformanceBenchmark = {
      operation,
      startTime: performance.now(),
      memoryBefore: process.memoryUsage(),
      metadata,
    };

    this.benchmarks.set(benchmarkId, benchmark);

    logger.debug('Performance benchmark started', {
      benchmarkId,
      operation,
      memoryBefore: this.formatMemoryUsage(benchmark.memoryBefore),
      metadata,
    });

    return benchmarkId;
  }

  /**
   * Ends a performance benchmark and returns metrics
   */
  endBenchmark(benchmarkId: string): PerformanceMetrics | null {
    const benchmark = this.benchmarks.get(benchmarkId);
    if (!benchmark) {
      logger.warn('Benchmark not found', { benchmarkId });
      return null;
    }

    benchmark.endTime = performance.now();
    benchmark.memoryAfter = process.memoryUsage();

    const executionTime = benchmark.endTime - benchmark.startTime;
    const memoryDelta = this.calculateMemoryDelta(
      benchmark.memoryBefore,
      benchmark.memoryAfter
    );

    const metrics: PerformanceMetrics = {
      memoryUsage: {
        heapUsed: Math.round(benchmark.memoryAfter.heapUsed / 1024 / 1024),
        heapTotal: Math.round(benchmark.memoryAfter.heapTotal / 1024 / 1024),
        external: Math.round(benchmark.memoryAfter.external / 1024 / 1024),
        rss: Math.round(benchmark.memoryAfter.rss / 1024 / 1024),
      },
      executionTime,
      throughput: {
        candlesPerSecond: 0, // Will be calculated by caller
        batchesPerSecond: 0, // Will be calculated by caller
      },
      systemLoad: {
        activeConnections: 0, // Will be set by caller
        queueSize: 0, // Will be set by caller
      },
    };

    // Store metrics
    this.addMetrics(metrics);

    logger.info('Performance benchmark completed', {
      benchmarkId,
      operation: benchmark.operation,
      executionTimeMs: Math.round(executionTime),
      memoryDelta,
      finalMemory: this.formatMemoryUsage(benchmark.memoryAfter),
      metadata: benchmark.metadata,
    });

    // Clean up benchmark
    this.benchmarks.delete(benchmarkId);

    return metrics;
  }

  /**
   * Measures execution time of an async function
   */
  async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<{ result: T; metrics: PerformanceMetrics }> {
    const benchmarkId = this.startBenchmark(operation, metadata);
    
    try {
      const result = await fn();
      const metrics = this.endBenchmark(benchmarkId);
      
      if (!metrics) {
        throw new Error('Failed to capture performance metrics');
      }

      return { result, metrics };
    } catch (error) {
      this.endBenchmark(benchmarkId);
      throw error;
    }
  }

  /**
   * Measures execution time of a synchronous function
   */
  measureSync<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): { result: T; metrics: PerformanceMetrics } {
    const benchmarkId = this.startBenchmark(operation, metadata);
    
    try {
      const result = fn();
      const metrics = this.endBenchmark(benchmarkId);
      
      if (!metrics) {
        throw new Error('Failed to capture performance metrics');
      }

      return { result, metrics };
    } catch (error) {
      this.endBenchmark(benchmarkId);
      throw error;
    }
  }

  /**
   * Gets current memory usage
   */
  getCurrentMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * Formats memory usage for logging
   */
  formatMemoryUsage(memoryUsage: NodeJS.MemoryUsage): Record<string, string> {
    return {
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
    };
  }

  /**
   * Calculates memory delta between two measurements
   */
  private calculateMemoryDelta(
    before: NodeJS.MemoryUsage,
    after: NodeJS.MemoryUsage
  ): Record<string, string> {
    return {
      heapUsed: `${Math.round((after.heapUsed - before.heapUsed) / 1024 / 1024)}MB`,
      heapTotal: `${Math.round((after.heapTotal - before.heapTotal) / 1024 / 1024)}MB`,
      external: `${Math.round((after.external - before.external) / 1024 / 1024)}MB`,
      rss: `${Math.round((after.rss - before.rss) / 1024 / 1024)}MB`,
    };
  }

  /**
   * Adds metrics to history
   */
  private addMetrics(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only the last N metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }
  }

  /**
   * Gets performance statistics
   */
  getPerformanceStats(): {
    averageExecutionTime: number;
    averageMemoryUsage: number;
    peakMemoryUsage: number;
    totalBenchmarks: number;
  } {
    if (this.metrics.length === 0) {
      return {
        averageExecutionTime: 0,
        averageMemoryUsage: 0,
        peakMemoryUsage: 0,
        totalBenchmarks: 0,
      };
    }

    const totalExecutionTime = this.metrics.reduce(
      (sum, m) => sum + m.executionTime,
      0
    );
    const totalMemoryUsage = this.metrics.reduce(
      (sum, m) => sum + m.memoryUsage.heapUsed,
      0
    );
    const peakMemoryUsage = Math.max(
      ...this.metrics.map(m => m.memoryUsage.heapUsed)
    );

    return {
      averageExecutionTime: totalExecutionTime / this.metrics.length,
      averageMemoryUsage: totalMemoryUsage / this.metrics.length,
      peakMemoryUsage,
      totalBenchmarks: this.metrics.length,
    };
  }

  /**
   * Checks if memory usage is within acceptable limits
   */
  checkMemoryLimits(limits: {
    maxHeapUsedMB: number;
    maxRssMB: number;
  }): {
    withinLimits: boolean;
    violations: string[];
    currentUsage: NodeJS.MemoryUsage;
  } {
    const currentUsage = this.getCurrentMemoryUsage();
    const violations: string[] = [];

    const heapUsedMB = Math.round(currentUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(currentUsage.rss / 1024 / 1024);

    if (heapUsedMB > limits.maxHeapUsedMB) {
      violations.push(
        `Heap usage ${heapUsedMB}MB exceeds limit ${limits.maxHeapUsedMB}MB`
      );
    }

    if (rssMB > limits.maxRssMB) {
      violations.push(
        `RSS usage ${rssMB}MB exceeds limit ${limits.maxRssMB}MB`
      );
    }

    return {
      withinLimits: violations.length === 0,
      violations,
      currentUsage,
    };
  }

  /**
   * Forces garbage collection if available
   */
  forceGarbageCollection(): boolean {
    if (global.gc) {
      global.gc();
      logger.debug('Forced garbage collection');
      return true;
    } else {
      logger.warn('Garbage collection not available (run with --expose-gc)');
      return false;
    }
  }

  /**
   * Clears all stored metrics and benchmarks
   */
  clear(): void {
    this.metrics.length = 0;
    this.benchmarks.clear();
    logger.debug('Performance monitor cleared');
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();