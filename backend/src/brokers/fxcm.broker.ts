import {
  BrokerAdapter,
  BrokerCandle,
  FxcmConfig,
  FxcmCandle,
  BrokerConnectionError,
  BrokerAuthenticationError,
  BrokerRateLimitError,
  BrokerError,
} from './broker.interface.js';
import { logger } from '../config/logger.js';

/**
 * FXCM Broker Adapter
 *
 * Implements the BrokerAdapter interface for FXCM's REST API.
 * Handles authentication, rate limiting, and data transformation
 * specific to FXCM's API format.
 */
export class FxcmBroker implements BrokerAdapter {
  private config: FxcmConfig;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private requestWindow: number = 60000; // 1 minute in milliseconds

  constructor(config: FxcmConfig) {
    this.config = config;
  }

  getBrokerName(): string {
    return this.config.name;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest(
        '/trading/get_model?models=Account'
      );
      return response.ok;
    } catch (error) {
      logger.error('FXCM connection validation failed', {
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
      const period = this.formatTimeframe(timeframe);
      const fromTime = Math.floor(from.getTime() / 1000); // FXCM uses Unix timestamps
      const toTime = Math.floor(to.getTime() / 1000);

      const url = `/trading/get_candles?offer_id=${instrument}&period_id=${period}&from=${fromTime}&to=${toTime}`;

      logger.debug('Fetching FXCM candles', {
        instrument,
        period,
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
          'Invalid response format from FXCM API',
          this.getBrokerName()
        );
      }

      const brokerCandles = data.candles.map((candle: any) =>
        this.transformFxcmCandle(candle)
      );

      logger.info('Successfully fetched FXCM candles', {
        count: brokerCandles.length,
        instrument,
        period,
        broker: this.getBrokerName(),
      });

      return brokerCandles;
    } catch (error) {
      logger.error('Failed to fetch FXCM candles', {
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
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'FXCM-API-Client/1.0',
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
      if (errorData.error || errorData.message) {
        errorMessage = errorData.error || errorData.message;
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

  private transformFxcmCandle(fxcmCandle: any): BrokerCandle {
    // FXCM provides separate bid and ask prices, we'll use the mid price
    if (!fxcmCandle.DateTime) {
      throw new BrokerError(
        'Invalid candle data: missing DateTime',
        this.getBrokerName()
      );
    }

    // Calculate mid prices from bid and ask
    const open = (fxcmCandle.BidOpen + fxcmCandle.AskOpen) / 2;
    const high = (fxcmCandle.BidHigh + fxcmCandle.AskHigh) / 2;
    const low = (fxcmCandle.BidLow + fxcmCandle.AskLow) / 2;
    const close = (fxcmCandle.BidClose + fxcmCandle.AskClose) / 2;

    return {
      timestamp: fxcmCandle.DateTime,
      open,
      high,
      low,
      close,
      volume: fxcmCandle.Volume || 0,
    };
  }

  private formatInstrumentName(pair: string): string {
    // FXCM uses different instrument identifiers
    // This would typically require a mapping table or API call to get offer IDs
    // For now, we'll use a simple mapping for common pairs
    const instrumentMap: Record<string, string> = {
      'XAU/USD': '1', // Gold/USD - this would need to be the actual FXCM offer ID
      'EUR/USD': '2', // Example mapping
      'GBP/USD': '3', // Example mapping
      'USD/JPY': '4', // Example mapping
    };

    const offerId = instrumentMap[pair];
    if (!offerId) {
      throw new BrokerError(
        `Unsupported trading pair: ${pair}`,
        this.getBrokerName()
      );
    }

    return offerId;
  }

  private formatTimeframe(timeframe: string): string {
    // Convert timeframe to FXCM period ID format
    const periodMap: Record<string, string> = {
      '1m': 'm1',
      '5m': 'm5',
      '15m': 'm15',
      '30m': 'm30',
      '1h': 'H1',
      '4h': 'H4',
      '1d': 'D1',
      '1w': 'W1',
      '1M': 'M1',
    };

    const periodId = periodMap[timeframe];
    if (!periodId) {
      throw new BrokerError(
        `Unsupported timeframe: ${timeframe}`,
        this.getBrokerName()
      );
    }

    return periodId;
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
