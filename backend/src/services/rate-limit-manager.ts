import { getLogger } from '../config/logger.js';

/**
 * Enhanced Rate Limit Manager for OANDA Integration
 * 
 * Implements sophisticated rate limiting with:
 * - Exponential backoff with jitter
 * - Request throttling and capacity reservation
 * - Adaptive rate limiting based on API responses
 * - Request chunking to handle count parameter limits
 * 
 * Requirements: 1.1, 1.2
 */

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerSecond: number;
  maxCandlesPerRequest: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  jitterFactor: number;
  adaptiveThreshold: number;
}

export interface RequestMetrics {
  timestamp: number;
  responseTime: number;
  success: boolean;
  rateLimited: boolean;
  retryAfter?: number;
}

export interface BackoffStrategy {
  attempt: number;
  baseDelay: number;
  jitter: number;
  totalDelay: number;
}

export class RateLimitManager {
  private config: RateLimitConfig;
  private requestHistory: RequestMetrics[] = [];
  private lastRequestTime: number = 0;
  private consecutiveFailures: number = 0;
  private adaptiveMultiplier: number = 1.0;
  private reservedCapacity: Map<string, number> = new Map();
  private readonly windowSizeMs = 60000; // 1 minute window
  private readonly shortWindowSizeMs = 1000; // 1 second window

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRequestsPerMinute: config.maxRequestsPerMinute || 120,
      maxRequestsPerSecond: config.maxRequestsPerSecond || 10,
      maxCandlesPerRequest: config.maxCandlesPerRequest || 5000, // OANDA's typical limit
      baseBackoffMs: config.baseBackoffMs || 1000,
      maxBackoffMs: config.maxBackoffMs || 30000,
      jitterFactor: config.jitterFactor || 0.1,
      adaptiveThreshold: config.adaptiveThreshold || 0.8,
      ...config,
    };

    const logger = getLogger();
    logger.info('RateLimitManager initialized', {
      config: this.config,
    });
  }

  /**
   * Checks if a request can be made immediately
   */
  canMakeRequest(requestCount: number = 1): boolean {
    const now = Date.now();
    
    // Clean old request history
    this.cleanRequestHistory(now);
    
    // Check per-second limit
    const recentRequests = this.getRequestsInWindow(now, this.shortWindowSizeMs);
    if (recentRequests.length >= this.config.maxRequestsPerSecond) {
      return false;
    }
    
    // Check per-minute limit with adaptive adjustment
    const minuteRequests = this.getRequestsInWindow(now, this.windowSizeMs);
    const effectiveLimit = Math.floor(
      this.config.maxRequestsPerMinute * this.adaptiveMultiplier
    );
    
    if (minuteRequests.length + requestCount > effectiveLimit) {
      return false;
    }
    
    // Check reserved capacity
    const totalReserved = Array.from(this.reservedCapacity.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    
    if (minuteRequests.length + requestCount + totalReserved > effectiveLimit) {
      return false;
    }
    
    return true;
  }

  /**
   * Reserves capacity for future requests
   */
  reserveCapacity(apiEndpoint: string, requestCount: number): boolean {
    if (!this.canMakeRequest(requestCount)) {
      return false;
    }
    
    this.reservedCapacity.set(apiEndpoint, requestCount);
    
    const logger = getLogger();
    logger.debug('Capacity reserved', {
      apiEndpoint,
      requestCount,
      totalReserved: Array.from(this.reservedCapacity.values()).reduce(
        (sum, count) => sum + count,
        0
      ),
    });
    
    return true;
  }

  /**
   * Releases reserved capacity
   */
  releaseCapacity(apiEndpoint: string): void {
    this.reservedCapacity.delete(apiEndpoint);
    
    const logger = getLogger();
    logger.debug('Capacity released', {
      apiEndpoint,
    });
  }

  /**
   * Calculates the required delay before the next request
   */
  getRequiredDelay(): number {
    const now = Date.now();
    
    if (!this.canMakeRequest()) {
      // Calculate delay based on rate limits
      const recentRequests = this.getRequestsInWindow(now, this.shortWindowSizeMs);
      const minuteRequests = this.getRequestsInWindow(now, this.windowSizeMs);
      
      let delay = 0;
      
      // Check per-second limit
      if (recentRequests.length >= this.config.maxRequestsPerSecond) {
        const oldestInSecond = Math.min(...recentRequests.map(r => r.timestamp));
        delay = Math.max(delay, this.shortWindowSizeMs - (now - oldestInSecond));
      }
      
      // Check per-minute limit
      const effectiveLimit = Math.floor(
        this.config.maxRequestsPerMinute * this.adaptiveMultiplier
      );
      
      if (minuteRequests.length >= effectiveLimit) {
        const oldestInMinute = Math.min(...minuteRequests.map(r => r.timestamp));
        delay = Math.max(delay, this.windowSizeMs - (now - oldestInMinute));
      }
      
      return Math.max(delay, 100); // Minimum 100ms delay
    }
    
    return 0;
  }

  /**
   * Calculates exponential backoff delay with jitter
   */
  calculateBackoffDelay(attempt: number, retryAfter?: number): BackoffStrategy {
    // Use server-provided retry-after if available
    if (retryAfter && retryAfter > 0) {
      const serverDelay = retryAfter * 1000; // Convert to milliseconds
      return {
        attempt,
        baseDelay: serverDelay,
        jitter: 0,
        totalDelay: serverDelay,
      };
    }
    
    // Calculate exponential backoff
    const baseDelay = Math.min(
      this.config.baseBackoffMs * Math.pow(2, attempt - 1),
      this.config.maxBackoffMs
    );
    
    // Add jitter to prevent thundering herd
    const jitter = baseDelay * this.config.jitterFactor * Math.random();
    const totalDelay = Math.floor(baseDelay + jitter);
    
    return {
      attempt,
      baseDelay,
      jitter,
      totalDelay,
    };
  }

  /**
   * Records a request attempt and its outcome
   */
  recordRequest(
    responseTime: number,
    success: boolean,
    rateLimited: boolean = false,
    retryAfter?: number
  ): void {
    const now = Date.now();
    
    const metrics: RequestMetrics = {
      timestamp: now,
      responseTime,
      success,
      rateLimited,
      ...(retryAfter !== undefined && { retryAfter }),
    };
    
    this.requestHistory.push(metrics);
    this.lastRequestTime = now;
    
    // Update failure tracking
    if (success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }
    
    // Update adaptive multiplier based on recent performance
    this.updateAdaptiveMultiplier();
    
    const logger = getLogger();
    logger.debug('Request recorded', {
      metrics,
      consecutiveFailures: this.consecutiveFailures,
      adaptiveMultiplier: this.adaptiveMultiplier,
    });
  }

  /**
   * Chunks a large date range into smaller requests to respect count limits
   * Enhanced with more aggressive chunking and better safety margins
   */
  chunkDateRange(
    fromDate: Date,
    toDate: Date,
    timeframeMs: number
  ): Array<{ fromDate: Date; toDate: Date; estimatedCount: number }> {
    const chunks: Array<{ fromDate: Date; toDate: Date; estimatedCount: number }> = [];
    const totalMs = toDate.getTime() - fromDate.getTime();
    
    // Use more conservative safety margin (80% instead of 90%) for better reliability
    const maxCandlesPerChunk = Math.floor(this.config.maxCandlesPerRequest * 0.8);
    
    // For very large date ranges, use even smaller chunks to prevent timeouts
    const totalEstimatedCandles = Math.ceil(totalMs / timeframeMs);
    const isLargeRequest = totalEstimatedCandles > maxCandlesPerChunk * 2;
    
    const effectiveMaxCandles = isLargeRequest 
      ? Math.floor(maxCandlesPerChunk * 0.5) // Use 50% for very large requests
      : maxCandlesPerChunk;
    
    // Calculate maximum time span per chunk
    const maxTimeSpanMs = effectiveMaxCandles * timeframeMs;
    
    let currentStart = new Date(fromDate);
    
    while (currentStart < toDate) {
      let currentEnd = new Date(
        Math.min(
          currentStart.getTime() + maxTimeSpanMs,
          toDate.getTime()
        )
      );
      
      // Ensure we don't create empty chunks
      if (currentEnd <= currentStart) {
        currentEnd = new Date(currentStart.getTime() + timeframeMs);
      }
      
      const chunkMs = currentEnd.getTime() - currentStart.getTime();
      const estimatedCount = Math.ceil(chunkMs / timeframeMs);
      
      // Additional safety check - if estimated count is still too high, reduce further
      if (estimatedCount > this.config.maxCandlesPerRequest) {
        const safeTimeSpan = Math.floor(this.config.maxCandlesPerRequest * 0.7) * timeframeMs;
        currentEnd = new Date(currentStart.getTime() + safeTimeSpan);
      }
      
      const finalChunkMs = currentEnd.getTime() - currentStart.getTime();
      const finalEstimatedCount = Math.ceil(finalChunkMs / timeframeMs);
      
      chunks.push({
        fromDate: new Date(currentStart),
        toDate: new Date(currentEnd),
        estimatedCount: finalEstimatedCount,
      });
      
      // Move to next chunk (add 1ms to avoid overlap)
      currentStart = new Date(currentEnd.getTime() + 1);
    }
    
    const logger = getLogger();
    logger.info('Date range chunked for rate limiting', {
      originalRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        totalMs,
        totalEstimatedCandles,
      },
      chunks: chunks.length,
      maxCandlesPerChunk,
      effectiveMaxCandles,
      isLargeRequest,
      timeframeMs,
      estimatedTotalCandles: chunks.reduce((sum, chunk) => sum + chunk.estimatedCount, 0),
      averageChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedCount, 0) / chunks.length) : 0,
    });
    
    return chunks;
  }

  /**
   * Waits for the appropriate delay before allowing the next request
   */
  async waitForNextRequest(): Promise<void> {
    const delay = this.getRequiredDelay();
    
    if (delay > 0) {
      const logger = getLogger();
      logger.info('Rate limit delay applied', {
        delayMs: delay,
        adaptiveMultiplier: this.adaptiveMultiplier,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Waits with exponential backoff after a failure
   */
  async waitWithBackoff(attempt: number, retryAfter?: number): Promise<BackoffStrategy> {
    const backoff = this.calculateBackoffDelay(attempt, retryAfter);
    
    const logger = getLogger();
    logger.warn('Applying exponential backoff', {
      attempt,
      backoff,
      consecutiveFailures: this.consecutiveFailures,
    });
    
    await new Promise(resolve => setTimeout(resolve, backoff.totalDelay));
    
    return backoff;
  }

  /**
   * Enhanced method to handle timeout scenarios with progressive delays
   */
  async waitForTimeoutRecovery(timeoutCount: number): Promise<void> {
    // Progressive delay for timeout recovery
    const baseDelay = Math.min(5000 * Math.pow(1.5, timeoutCount - 1), 30000); // 5s, 7.5s, 11.25s, ... up to 30s
    const jitter = baseDelay * 0.2 * Math.random(); // 20% jitter
    const totalDelay = Math.floor(baseDelay + jitter);
    
    const logger = getLogger();
    logger.warn('Applying timeout recovery delay', {
      timeoutCount,
      baseDelay,
      jitter,
      totalDelay,
    });
    
    await new Promise(resolve => setTimeout(resolve, totalDelay));
  }

  /**
   * Validates if a request should proceed based on current system state
   */
  shouldProceedWithRequest(): { canProceed: boolean; reason?: string; suggestedDelay?: number } {
    // Check if we're in a failure state
    if (this.consecutiveFailures >= 5) {
      return {
        canProceed: false,
        reason: 'Too many consecutive failures',
        suggestedDelay: this.calculateBackoffDelay(this.consecutiveFailures).totalDelay,
      };
    }
    
    // Check if adaptive multiplier is too low (indicating severe rate limiting)
    if (this.adaptiveMultiplier < 0.3) {
      return {
        canProceed: false,
        reason: 'Adaptive rate limiting active - system under stress',
        suggestedDelay: 10000, // 10 second delay
      };
    }
    
    // Check basic rate limits
    if (!this.canMakeRequest()) {
      return {
        canProceed: false,
        reason: 'Rate limit exceeded',
        suggestedDelay: this.getRequiredDelay(),
      };
    }
    
    return { canProceed: true };
  }

  /**
   * Gets current rate limiting statistics
   */
  getStatistics(): {
    requestsInLastMinute: number;
    requestsInLastSecond: number;
    averageResponseTime: number;
    successRate: number;
    adaptiveMultiplier: number;
    consecutiveFailures: number;
    reservedCapacity: number;
  } {
    const now = Date.now();
    const minuteRequests = this.getRequestsInWindow(now, this.windowSizeMs);
    const secondRequests = this.getRequestsInWindow(now, this.shortWindowSizeMs);
    
    const successfulRequests = this.requestHistory.filter(r => r.success);
    const averageResponseTime = successfulRequests.length > 0
      ? successfulRequests.reduce((sum, r) => sum + r.responseTime, 0) / successfulRequests.length
      : 0;
    
    const successRate = this.requestHistory.length > 0
      ? successfulRequests.length / this.requestHistory.length
      : 1;
    
    const totalReserved = Array.from(this.reservedCapacity.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    
    return {
      requestsInLastMinute: minuteRequests.length,
      requestsInLastSecond: secondRequests.length,
      averageResponseTime,
      successRate,
      adaptiveMultiplier: this.adaptiveMultiplier,
      consecutiveFailures: this.consecutiveFailures,
      reservedCapacity: totalReserved,
    };
  }

  /**
   * Updates the configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    const logger = getLogger();
    logger.info('RateLimitManager configuration updated', {
      config: this.config,
    });
  }

  /**
   * Resets the rate limiter state
   */
  reset(): void {
    this.requestHistory = [];
    this.lastRequestTime = 0;
    this.consecutiveFailures = 0;
    this.adaptiveMultiplier = 1.0;
    this.reservedCapacity.clear();
    
    const logger = getLogger();
    logger.info('RateLimitManager state reset');
  }

  // Private helper methods

  private cleanRequestHistory(now: number): void {
    // Keep only requests from the last minute
    this.requestHistory = this.requestHistory.filter(
      request => now - request.timestamp <= this.windowSizeMs
    );
  }

  private getRequestsInWindow(now: number, windowMs: number): RequestMetrics[] {
    return this.requestHistory.filter(
      request => now - request.timestamp <= windowMs
    );
  }

  private updateAdaptiveMultiplier(): void {
    const now = Date.now();
    const recentRequests = this.getRequestsInWindow(now, this.windowSizeMs);
    
    if (recentRequests.length < 10) {
      // Not enough data for adaptation
      return;
    }
    
    const rateLimitedRequests = recentRequests.filter(r => r.rateLimited);
    const rateLimitedRatio = rateLimitedRequests.length / recentRequests.length;
    
    // Adjust multiplier based on rate limiting frequency
    if (rateLimitedRatio > this.config.adaptiveThreshold) {
      // Too many rate limited requests - reduce multiplier
      this.adaptiveMultiplier = Math.max(0.5, this.adaptiveMultiplier * 0.9);
    } else if (rateLimitedRatio < this.config.adaptiveThreshold * 0.5) {
      // Low rate limiting - gradually increase multiplier
      this.adaptiveMultiplier = Math.min(1.0, this.adaptiveMultiplier * 1.05);
    }
    
    const logger = getLogger();
    logger.debug('Adaptive multiplier updated', {
      rateLimitedRatio,
      adaptiveMultiplier: this.adaptiveMultiplier,
      recentRequestsCount: recentRequests.length,
    });
  }
}

/**
 * Default rate limit manager instance for OANDA
 */
export const oandaRateLimitManager = new RateLimitManager({
  maxRequestsPerMinute: 120,
  maxRequestsPerSecond: 10,
  maxCandlesPerRequest: 5000,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
  jitterFactor: 0.1,
  adaptiveThreshold: 0.8,
});