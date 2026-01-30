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
import { logger } from '../config/logger.js';

/**
 * OANDA Broker Adapter
 *
 * Implements the BrokerAdapter interface for OANDA's REST API.
 * Handles authentication, rate limiting, and data transformation
 * specific to OANDA's API format.
 */
export class OandaBroker implements BrokerAdapter {
  private config: OandaConfig;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private requestWindow: number = 60000; // 1 minute in milliseconds

  constructor(config: OandaConfig) {
    this.config = config;
  }

  getBrokerName(): string {
    return this.config.name;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/v3/accounts');
      return response.ok;
    } catch (error) {
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
    try {
      await this.enforceRateLimit();

      const instrument = this.formatInstrumentName(pair);
      const granularity = this.formatTimeframe(timeframe);
      const fromTime = from.toISOString();
      const toTime = to.toISOString();

      const url = `/v3/instruments/${instrument}/candles?granularity=${granularity}&from=${fromTime}&to=${toTime}&price=BA`;

      logger.debug('Fetching OANDA candles', {
        instrument,
        granularity,
        from: fromTime,
        to: toTime,
        broker: this.getBrokerName(),
      });

      const response = await this.makeRequest(url);

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

      logger.info('Successfully fetched OANDA candles', {
        count: brokerCandles.length,
        instrument,
        granularity,
        broker: this.getBrokerName(),
      });

      return brokerCandles;
    } catch (error) {
      logger.error('Failed to fetch OANDA candles', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pair,
        timeframe,
        from: from.toISOString(),
        to: to.toISOString(),
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

  private async makeRequest(endpoint: string): Promise<Response> {
    const url = `${this.config.apiUrl}${endpoint}`;

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        timeout: 30000, // 30 second timeout
      });

      this.updateRateLimitTracking();
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
        throw new BrokerRateLimitError(
          this.getBrokerName(),
          retryAfter ? parseInt(retryAfter, 10) : undefined
        );
      case 400:
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

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counter if we're in a new window
    if (now - this.lastRequestTime > this.requestWindow) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }

    // Check if we're approaching the rate limit
    if (this.requestCount >= this.config.rateLimitPerMinute) {
      const waitTime = this.requestWindow - (now - this.lastRequestTime);
      if (waitTime > 0) {
        logger.warn('Rate limit reached, waiting before next request', {
          waitTime,
          broker: this.getBrokerName(),
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.requestCount = 0;
        this.lastRequestTime = Date.now();
      }
    }
  }

  private updateRateLimitTracking(): void {
    this.requestCount++;
  }
}
