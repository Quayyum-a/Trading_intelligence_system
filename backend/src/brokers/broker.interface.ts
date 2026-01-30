/**
 * Broker Adapter Interface
 *
 * Defines the common contract for all broker implementations to ensure
 * broker-agnostic data ingestion. All broker adapters must implement
 * this interface to provide consistent data access patterns.
 */

export interface BrokerCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface BrokerAdapter {
  /**
   * Fetches candlestick data from the broker API
   * @param pair - Trading pair (e.g., 'XAU/USD')
   * @param timeframe - Timeframe for candles (e.g., '15m')
   * @param from - Start date for data retrieval
   * @param to - End date for data retrieval
   * @returns Promise resolving to array of broker candles
   */
  fetchCandles(
    pair: string,
    timeframe: string,
    from: Date,
    to: Date
  ): Promise<BrokerCandle[]>;

  /**
   * Validates the connection to the broker API
   * @returns Promise resolving to true if connection is valid
   */
  validateConnection(): Promise<boolean>;

  /**
   * Gets the broker name for identification
   * @returns The broker name
   */
  getBrokerName(): string;
}

export interface BrokerConfig {
  type: 'oanda' | 'fxcm';
  name: string;
  enabled: boolean;
  rateLimitPerMinute: number;
}

export interface OandaConfig extends BrokerConfig {
  type: 'oanda';
  apiUrl: string;
  apiKey: string;
  accountId: string;
}

export interface FxcmConfig extends BrokerConfig {
  type: 'fxcm';
  apiUrl: string;
  accessToken: string;
}

export type BrokerConfiguration = OandaConfig | FxcmConfig;

/**
 * Broker-specific data structures for API responses
 */
export interface OandaCandle {
  time: string;
  bid: { o: string; h: string; l: string; c: string };
  ask: { o: string; h: string; l: string; c: string };
  volume: number;
}

export interface FxcmCandle {
  DateTime: string;
  BidOpen: number;
  BidHigh: number;
  BidLow: number;
  BidClose: number;
  AskOpen: number;
  AskHigh: number;
  AskLow: number;
  AskClose: number;
}

/**
 * Error types for broker operations
 */
export class BrokerError extends Error {
  constructor(
    message: string,
    public brokerName: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

export class BrokerConnectionError extends BrokerError {
  constructor(brokerName: string, originalError?: Error) {
    super(
      `Failed to connect to ${brokerName} broker`,
      brokerName,
      originalError
    );
    this.name = 'BrokerConnectionError';
  }
}

export class BrokerAuthenticationError extends BrokerError {
  constructor(brokerName: string, originalError?: Error) {
    super(
      `Authentication failed for ${brokerName} broker`,
      brokerName,
      originalError
    );
    this.name = 'BrokerAuthenticationError';
  }
}

export class BrokerRateLimitError extends BrokerError {
  constructor(brokerName: string, retryAfter?: number) {
    super(
      `Rate limit exceeded for ${brokerName} broker${retryAfter ? `, retry after ${retryAfter}s` : ''}`,
      brokerName
    );
    this.name = 'BrokerRateLimitError';
  }
}
