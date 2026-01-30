import { Candle } from '../types/database.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

/**
 * Validation errors for indicator calculations
 */
export class IndicatorValidationError extends Error {
  constructor(message: string, public readonly indicator: string, public readonly details?: any) {
    super(message);
    this.name = 'IndicatorValidationError';
  }
}

/**
 * Calculation errors for indicator functions
 */
export class IndicatorCalculationError extends Error {
  constructor(message: string, public readonly indicator: string, public readonly details?: any) {
    super(message);
    this.name = 'IndicatorCalculationError';
  }
}

/**
 * Validate input data for indicator calculations
 */
export function validateCandleData(candles: Candle[], indicator: string, minCandles: number = 1): void {
  if (!candles || !Array.isArray(candles)) {
    throw new IndicatorValidationError(
      'Candles must be a non-empty array',
      indicator,
      { provided: typeof candles }
    );
  }

  if (candles.length === 0) {
    throw new IndicatorValidationError(
      'Candles array cannot be empty',
      indicator,
      { length: candles.length }
    );
  }

  if (candles.length < minCandles) {
    throw new IndicatorValidationError(
      `Insufficient candles for ${indicator} calculation`,
      indicator,
      { required: minCandles, provided: candles.length }
    );
  }

  // Validate each candle
  for (let i = 0; i < candles.length; i++) {
    validateSingleCandle(candles[i], indicator, i);
  }

  // Validate chronological order
  validateChronologicalOrder(candles, indicator);
}

/**
 * Validate a single candle's data integrity
 */
export function validateSingleCandle(candle: Candle, indicator: string, index?: number): void {
  const candleRef = index !== undefined ? `candle[${index}]` : 'candle';

  if (!candle) {
    throw new IndicatorValidationError(
      `${candleRef} is null or undefined`,
      indicator,
      { index }
    );
  }

  // Validate required fields
  if (!candle.pair || typeof candle.pair !== 'string') {
    throw new IndicatorValidationError(
      `${candleRef}.pair is required and must be a string`,
      indicator,
      { index, pair: candle.pair }
    );
  }

  if (!candle.timeframe || typeof candle.timeframe !== 'string') {
    throw new IndicatorValidationError(
      `${candleRef}.timeframe is required and must be a string`,
      indicator,
      { index, timeframe: candle.timeframe }
    );
  }

  if (!candle.timestamp || !(candle.timestamp instanceof Date)) {
    throw new IndicatorValidationError(
      `${candleRef}.timestamp is required and must be a Date`,
      indicator,
      { index, timestamp: candle.timestamp }
    );
  }

  // Validate OHLCV values
  validateOHLCVValues(candle, indicator, candleRef);

  // Validate OHLC relationships
  validateOHLCRelationships(candle, indicator, candleRef);
}

/**
 * Validate OHLCV numeric values
 */
export function validateOHLCVValues(candle: Candle, indicator: string, candleRef: string): void {
  const prices = { open: candle.open, high: candle.high, low: candle.low, close: candle.close };
  
  for (const [field, value] of Object.entries(prices)) {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
      throw new IndicatorValidationError(
        `${candleRef}.${field} must be a valid finite number`,
        indicator,
        { field, value, candleRef }
      );
    }

    if (value <= 0) {
      throw new IndicatorValidationError(
        `${candleRef}.${field} must be positive`,
        indicator,
        { field, value, candleRef }
      );
    }
  }

  // Validate volume
  if (typeof candle.volume !== 'number' || isNaN(candle.volume) || !isFinite(candle.volume)) {
    throw new IndicatorValidationError(
      `${candleRef}.volume must be a valid finite number`,
      indicator,
      { volume: candle.volume, candleRef }
    );
  }

  if (candle.volume < 0) {
    throw new IndicatorValidationError(
      `${candleRef}.volume cannot be negative`,
      indicator,
      { volume: candle.volume, candleRef }
    );
  }
}

/**
 * Validate OHLC price relationships
 */
export function validateOHLCRelationships(candle: Candle, indicator: string, candleRef: string): void {
  if (candle.high < candle.low) {
    throw new IndicatorValidationError(
      `${candleRef}: High price cannot be less than low price`,
      indicator,
      { high: candle.high, low: candle.low, candleRef }
    );
  }

  if (candle.high < candle.open) {
    throw new IndicatorValidationError(
      `${candleRef}: High price cannot be less than open price`,
      indicator,
      { high: candle.high, open: candle.open, candleRef }
    );
  }

  if (candle.high < candle.close) {
    throw new IndicatorValidationError(
      `${candleRef}: High price cannot be less than close price`,
      indicator,
      { high: candle.high, close: candle.close, candleRef }
    );
  }

  if (candle.low > candle.open) {
    throw new IndicatorValidationError(
      `${candleRef}: Low price cannot be greater than open price`,
      indicator,
      { low: candle.low, open: candle.open, candleRef }
    );
  }

  if (candle.low > candle.close) {
    throw new IndicatorValidationError(
      `${candleRef}: Low price cannot be greater than close price`,
      indicator,
      { low: candle.low, close: candle.close, candleRef }
    );
  }
}

/**
 * Validate that candles are in chronological order
 */
export function validateChronologicalOrder(candles: Candle[], indicator: string): void {
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    if (current.timestamp <= previous.timestamp) {
      throw new IndicatorValidationError(
        'Candles must be in chronological order',
        indicator,
        {
          index: i,
          currentTimestamp: current.timestamp.toISOString(),
          previousTimestamp: previous.timestamp.toISOString()
        }
      );
    }
  }
}

/**
 * Validate period parameter for indicators
 */
export function validatePeriod(period: number, indicator: string, allowedPeriods?: number[]): void {
  if (typeof period !== 'number' || isNaN(period) || !isFinite(period)) {
    throw new IndicatorValidationError(
      'Period must be a valid finite number',
      indicator,
      { period }
    );
  }

  if (period <= 0) {
    throw new IndicatorValidationError(
      'Period must be greater than 0',
      indicator,
      { period }
    );
  }

  if (!Number.isInteger(period)) {
    throw new IndicatorValidationError(
      'Period must be an integer',
      indicator,
      { period }
    );
  }

  if (allowedPeriods && !allowedPeriods.includes(period)) {
    throw new IndicatorValidationError(
      `Period must be one of: ${allowedPeriods.join(', ')}`,
      indicator,
      { period, allowedPeriods }
    );
  }
}

/**
 * Handle mathematical errors in calculations
 */
export function handleMathematicalError(error: unknown, indicator: string, operation: string): never {
  const errorMessage = error instanceof Error ? error.message : 'Unknown mathematical error';
  
  logger.error('Mathematical error in indicator calculation', {
    indicator,
    operation,
    error: errorMessage,
    stack: error instanceof Error ? error.stack : undefined
  });

  throw new IndicatorCalculationError(
    `Mathematical error in ${operation}: ${errorMessage}`,
    indicator,
    { operation, originalError: errorMessage }
  );
}

/**
 * Safe division with zero check
 */
export function safeDivision(numerator: number, denominator: number, indicator: string, operation: string): number {
  if (denominator === 0) {
    throw new IndicatorCalculationError(
      `Division by zero in ${operation}`,
      indicator,
      { numerator, denominator, operation }
    );
  }

  const result = numerator / denominator;
  
  if (!isFinite(result)) {
    throw new IndicatorCalculationError(
      `Division resulted in non-finite value in ${operation}`,
      indicator,
      { numerator, denominator, result, operation }
    );
  }

  return result;
}

/**
 * Validate calculation result
 */
export function validateCalculationResult(
  result: number, 
  indicator: string, 
  operation: string,
  allowNegative: boolean = false
): void {
  if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
    throw new IndicatorCalculationError(
      `Invalid calculation result in ${operation}`,
      indicator,
      { result, operation }
    );
  }

  if (!allowNegative && result < 0) {
    throw new IndicatorCalculationError(
      `Negative result not allowed in ${operation}`,
      indicator,
      { result, operation }
    );
  }
}

/**
 * Log and handle insufficient data scenarios
 */
export function handleInsufficientData(
  required: number, 
  available: number, 
  indicator: string
): never {
  logger.warn('Insufficient data for indicator calculation', {
    indicator,
    required,
    available,
    shortfall: required - available
  });

  throw new IndicatorValidationError(
    `Insufficient data for ${indicator} calculation`,
    indicator,
    { required, available, shortfall: required - available }
  );
}