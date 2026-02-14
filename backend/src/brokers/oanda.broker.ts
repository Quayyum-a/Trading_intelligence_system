import {
  BrokerAdapter,
  BrokerCandle,
  OandaConfig,
  OandaCandle,
  BrokerConnectionError,
  BrokerAuthenticationError,
  BrokerRateLimitError,
  BrokerError,
} from './broker.interface.js';
import { getLogger } from '../config/logger.js';
import { RateLimitManager } from '../services/rate-limit-manager.js';

/**
 * OANDA Broker Adapter
 *
 * Implements the BrokerAdapter interface for OANDA's REST API.
 * Handles authentication, enhanced rate limiting with exponential backoff,
 * request chunking, and data transformation specific to OANDA's API format.
 * 
 * Features:
 * - Enhanced rate limiting with exponential backoff and jitter
 * - Request throttling and capacity reservation
 * - Adaptive rate limiting based on API responses
 * - Automatic request chunking to handle count parameter limits
 * 
 * Requirements: 1.1, 1.2
 */
export class OandaBroker implements BrokerAdapter {
  private config: OandaConfig;
  private rateLimitManager: RateLimitManager;

  constructor(config: OandaConfig) {
    this.config = config;
    
    // Initialize rate limit manager with OANDA-specific settings
    this.rateLimitManager = new RateLimitManager({
      maxRequestsPerMinute: config.rateLimitPerMinute || 120,
      maxRequestsPerSecond: 10,
      maxCandlesPerRequest: 5000, // OANDA's maximum candles per request
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitterFactor: 0.1,
      adaptiveThreshold: 0.8,
    });
    
    const logger = getLogger();
    logger.info('OANDA broker initialized with enhanced rate limiting', {
      brokerName: this.getBrokerName(),
      rateLimitConfig: {
        maxRequestsPerMinute: config.rateLimitPerMinute || 120,
        maxCandlesPerRequest: 5000,
      },
    });
  }

  getBrokerName(): string {
    return this.config.name;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/v3/accounts');
      return response.ok;
    } catch (error) {
      const logger = getLogger();
      logger.error('OANDA connection validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        broker: this.getBrokerName(),
      });
      return false;
    }
  }

  async fetchCandles(
    pair: string,
    timeframe: string,
    from: Date,
    to: Date
  ): Promise<BrokerCandle[]> {
    const startTime = Date.now();
    let timeoutCount = 0;
    
    try {
      const instrument = this.formatInstrumentName(pair);
      const granularity = this.formatTimeframe(timeframe);
      const timeframeMs = this.getTimeframeMs(timeframe);
      
      const logger = getLogger();
      logger.debug('Starting OANDA candle fetch with enhanced rate limiting', {
        instrument,
        granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        broker: this.getBrokerName(),
      });

      // Check if we should proceed with the request
      const proceedCheck = this.rateLimitManager.shouldProceedWithRequest();
      if (!proceedCheck.canProceed) {
        logger.warn('Request blocked by rate limit manager', {
          reason: proceedCheck.reason,
          suggestedDelay: proceedCheck.suggestedDelay,
        });
        
        if (proceedCheck.suggestedDelay) {
          await new Promise(resolve => setTimeout(resolve, proceedCheck.suggestedDelay));
        }
      }

      // Check if we need to chunk the request due to count limits
      const chunks = this.rateLimitManager.chunkDateRange(from, to, timeframeMs);
      
      if (chunks.length > 1) {
        logger.info('Request chunked due to count limits', {
          instrument,
          granularity,
          totalChunks: chunks.length,
          estimatedTotalCandles: chunks.reduce((sum, chunk) => sum + chunk.estimatedCount, 0),
          averageChunkSize: Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedCount, 0) / chunks.length),
        });
      }
      
      const allCandles: BrokerCandle[] = [];
      
      // Process each chunk with enhanced rate limiting and timeout handling
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        logger.debug('Processing chunk', {
          chunkIndex: i + 1,
          totalChunks: chunks.length,
          chunkFrom: chunk.fromDate.toISOString(),
          chunkTo: chunk.toDate.toISOString(),
          estimatedCount: chunk.estimatedCount,
        });
        
        // Wait for rate limiting if needed
        await this.rateLimitManager.waitForNextRequest();
        
        try {
          const chunkCandles = await this.fetchCandleChunk(
            instrument,
            granularity,
            chunk.fromDate,
            chunk.toDate
          );
          
          allCandles.push(...chunkCandles);
          
          // Record successful request
          this.rateLimitManager.recordRequest(
            Date.now() - startTime,
            true,
            false
          );
          
          // Reset timeout count on success
          timeoutCount = 0;
          
        } catch (error) {
          // Handle timeout specifically
          if (error instanceof Error && (
            error.message.includes('timeout') || 
            error.message.includes('AbortError') ||
            error.name === 'TimeoutError'
          )) {
            timeoutCount++;
            logger.warn('Chunk fetch timed out, applying recovery delay', {
              chunkIndex: i + 1,
              timeoutCount,
              error: error.message,
            });
            
            await this.rateLimitManager.waitForTimeoutRecovery(timeoutCount);
            
            // Retry the chunk once after timeout recovery
            try {
              const retryCandles = await this.fetchCandleChunk(
                instrument,
                granularity,
                chunk.fromDate,
                chunk.toDate
              );
              
              allCandles.push(...retryCandles);
              
              // Record successful retry
              this.rateLimitManager.recordRequest(
                Date.now() - startTime,
                true,
                false
              );
              
              logger.info('Chunk fetch succeeded after timeout recovery', {
                chunkIndex: i + 1,
                timeoutCount,
              });
              
            } catch (retryError) {
              // Record failed retry
              this.rateLimitManager.recordRequest(
                Date.now() - startTime,
                false,
                false
              );
              
              logger.error('Chunk fetch failed even after timeout recovery', {
                chunkIndex: i + 1,
                timeoutCount,
                retryError: retryError instanceof Error ? retryError.message : 'Unknown error',
              });
              
              throw retryError;
            }
          } else {
            // Non-timeout error, handle normally
            throw error;
          }
        }
        
        // Adaptive delay between chunks based on system performance
        if (i < chunks.length - 1) {
          const adaptiveDelay = Math.max(100, Math.floor(200 * (1 / this.rateLimitManager.getStatistics().adaptiveMultiplier)));
          await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
        }
      }
      
      // Remove duplicates that might occur at chunk boundaries
      const uniqueCandles = this.removeDuplicateCandles(allCandles);
      
      logger.info('Successfully fetched OANDA candles with enhanced rate limiting', {
        instrument,
        granularity,
        totalChunks: chunks.length,
        totalCandles: uniqueCandles.length,
        processingTimeMs: Date.now() - startTime,
        timeoutCount,
        rateLimitStats: this.rateLimitManager.getStatistics(),
        broker: this.getBrokerName(),
      });

      return uniqueCandles;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Record failed request
      const isRateLimited = error instanceof BrokerRateLimitError;
      this.rateLimitManager.recordRequest(
        processingTime,
        false,
        isRateLimited,
        isRateLimited ? (error as any).retryAfter : undefined
      );
      
      const logger = getLogger();
      logger.error('Failed to fetch OANDA candles', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair,
        timeframe,
        from: from.toISOString(),
        to: to.toISOString(),
        processingTimeMs: processingTime,
        timeoutCount,
        rateLimitStats: this.rateLimitManager.getStatistics(),
        broker: this.getBrokerName(),
      });

      if (error instanceof BrokerError) {
        throw error;
      }

      throw new BrokerError(
        `Failed to fetch candles: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.getBrokerName(),
        error instanceof Error ? error : undefined
      );
    }
  }

  private async makeRequest(endpoint: string, timeoutMs: number = 30000): Promise<Response> {
    const url = `${this.config.apiUrl}${endpoint}`;

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    try {
      // Create an AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          throw new BrokerConnectionError(this.getBrokerName(), error);
        }
        if (
          error.message.includes('network') ||
          error.message.includes('fetch')
        ) {
          throw new BrokerConnectionError(this.getBrokerName(), error);
        }
      }
      throw new BrokerError(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.getBrokerName(),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Fetches a single chunk of candles with retry logic and exponential backoff
   */
  private async fetchCandleChunk(
    instrument: string,
    granularity: string,
    fromDate: Date,
    toDate: Date,
    maxRetries: number = 3
  ): Promise<BrokerCandle[]> {
    const fromTime = fromDate.toISOString();
    const toTime = toDate.toISOString();
    const url = `/v3/instruments/${instrument}/candles?granularity=${granularity}&from=${fromTime}&to=${toTime}&price=BA`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const logger = getLogger();
        logger.debug('Fetching OANDA candle chunk', {
          instrument,
          granularity,
          from: fromTime,
          to: toTime,
          attempt,
          maxRetries,
          broker: this.getBrokerName(),
        });

        // Use shorter timeout for individual chunks to fail fast
        const chunkTimeout = Math.min(15000, 5000 * attempt); // 5s, 10s, 15s
        const response = await this.makeRequest(url, chunkTimeout);

        if (!response.ok) {
          await this.handleErrorResponse(response);
        }

        const data = await response.json();

        if (!data.candles || !Array.isArray(data.candles)) {
          throw new BrokerError(
            'Invalid response format from OANDA API',
            this.getBrokerName()
          );
        }

        const brokerCandles = data.candles
          .filter((candle: any) => candle.complete) // Only use completed candles
          .map((candle: any) => this.transformOandaCandle(candle));

        if (attempt > 1) {
          logger.info('OANDA chunk fetch succeeded after retry', {
            instrument,
            granularity,
            attempt,
            candleCount: brokerCandles.length,
          });
        }

        return brokerCandles;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        const logger = getLogger();
        logger.warn('OANDA chunk fetch attempt failed', {
          instrument,
          granularity,
          attempt,
          maxRetries,
          error: lastError.message,
          errorType: lastError.constructor.name,
          broker: this.getBrokerName(),
        });

        if (attempt < maxRetries) {
          // Use rate limit manager for exponential backoff
          const retryAfter = error instanceof BrokerRateLimitError 
            ? (error as any).retryAfter 
            : undefined;
          
          await this.rateLimitManager.waitWithBackoff(attempt, retryAfter);
        }
      }
    }

    throw new BrokerError(
      `Failed to fetch candle chunk after ${maxRetries} attempts: ${lastError?.message}`,
      this.getBrokerName(),
      lastError
    );
  }

  /**
   * Removes duplicate candles that might occur at chunk boundaries
   */
  private removeDuplicateCandles(candles: BrokerCandle[]): BrokerCandle[] {
    const seen = new Set<string>();
    const unique: BrokerCandle[] = [];

    for (const candle of candles) {
      const key = candle.timestamp;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(candle);
      }
    }

    // Sort by timestamp to ensure chronological order
    unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (unique.length !== candles.length) {
      const logger = getLogger();
      logger.debug('Removed duplicate candles', {
        originalCount: candles.length,
        uniqueCount: unique.length,
        duplicatesRemoved: candles.length - unique.length,
      });
    }

    return unique;
  }

  /**
   * Gets the timeframe interval in milliseconds
   */
  private getTimeframeMs(timeframe: string): number {
    const intervals: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000, // Approximate
    };

    return intervals[timeframe] || 15 * 60 * 1000; // Default to 15 minutes
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const statusCode = response.status;
    let errorMessage = `HTTP ${statusCode}`;

    try {
      const errorData = await response.json();
      if (errorData.errorMessage) {
        errorMessage = errorData.errorMessage;
      }
    } catch {
      // If we can't parse the error response, use the status text
      errorMessage = response.statusText || errorMessage;
    }

    switch (statusCode) {
      case 401:
        throw new BrokerAuthenticationError(this.getBrokerName());
      case 429:
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        
        // Record rate limit hit for adaptive adjustment
        this.rateLimitManager.recordRequest(0, false, true, retryAfterSeconds);
        
        throw new BrokerRateLimitError(
          this.getBrokerName(),
          retryAfterSeconds
        );
      case 400:
        // Check if this is a count parameter error
        if (errorMessage.includes('count') && errorMessage.includes('exceeded')) {
          const logger = getLogger();
          logger.warn('OANDA count parameter exceeded, request will be chunked', {
            errorMessage,
            broker: this.getBrokerName(),
          });
        }
        throw new BrokerError(
          `Bad request: ${errorMessage}`,
          this.getBrokerName()
        );
      case 404:
        throw new BrokerError(
          `Resource not found: ${errorMessage}`,
          this.getBrokerName()
        );
      case 500:
      case 502:
      case 503:
      case 504:
        throw new BrokerConnectionError(this.getBrokerName());
      default:
        throw new BrokerError(
          `API error: ${errorMessage}`,
          this.getBrokerName()
        );
    }
  }

  private transformOandaCandle(oandaCandle: any): BrokerCandle {
    // OANDA provides bid and ask prices, we'll use the mid price
    const bid = oandaCandle.bid;
    const ask = oandaCandle.ask;

    if (!bid || !ask) {
      throw new BrokerError(
        'Invalid candle data: missing bid or ask prices',
        this.getBrokerName()
      );
    }

    return {
      timestamp: oandaCandle.time,
      open: (parseFloat(bid.o) + parseFloat(ask.o)) / 2,
      high: (parseFloat(bid.h) + parseFloat(ask.h)) / 2,
      low: (parseFloat(bid.l) + parseFloat(ask.l)) / 2,
      close: (parseFloat(bid.c) + parseFloat(ask.c)) / 2,
      volume: oandaCandle.volume || 0,
    };
  }

  private formatInstrumentName(pair: string): string {
    // Convert pair format like 'XAU/USD' to OANDA format 'XAU_USD'
    return pair.replace('/', '_');
  }

  private formatTimeframe(timeframe: string): string {
    // Convert timeframe to OANDA granularity format
    const timeframeMap: Record<string, string> = {
      '1m': 'M1',
      '5m': 'M5',
      '15m': 'M15',
      '30m': 'M30',
      '1h': 'H1',
      '4h': 'H4',
      '1d': 'D',
      '1w': 'W',
      '1M': 'M',
    };

    const granularity = timeframeMap[timeframe];
    if (!granularity) {
      throw new BrokerError(
        `Unsupported timeframe: ${timeframe}`,
        this.getBrokerName()
      );
    }

    return granularity;
  }

  /**
   * Gets rate limiting statistics from the rate limit manager
   */
  getRateLimitStatistics(): {
    requestsInLastMinute: number;
    requestsInLastSecond: number;
    averageResponseTime: number;
    successRate: number;
    adaptiveMultiplier: number;
    consecutiveFailures: number;
    reservedCapacity: number;
  } {
    return this.rateLimitManager.getStatistics();
  }

  /**
   * Updates the rate limiting configuration
   */
  updateRateLimitConfig(config: Partial<{
    maxRequestsPerMinute: number;
    maxRequestsPerSecond: number;
    maxCandlesPerRequest: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
    jitterFactor: number;
    adaptiveThreshold: number;
  }>): void {
    this.rateLimitManager.updateConfig(config);
    
    const logger = getLogger();
    logger.info('OANDA broker rate limit configuration updated', {
      broker: this.getBrokerName(),
      config,
    });
  }

  /**
   * Resets the rate limiting state
   */
  resetRateLimiting(): void {
    this.rateLimitManager.reset();
    
    const logger = getLogger();
    logger.info('OANDA broker rate limiting state reset', {
      broker: this.getBrokerName(),
    });
  }
}
