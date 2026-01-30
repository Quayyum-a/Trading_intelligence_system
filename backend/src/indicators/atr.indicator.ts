import { Candle } from '../types/database.js';
import { ATRResult, TrueRangeResult } from './indicator.interface.js';

/**
 * Calculate True Range for a single candle
 * 
 * True Range = MAX(
 *   High - Low,
 *   |High - Previous Close|,
 *   |Low - Previous Close|
 * )
 * 
 * @param current - Current candle
 * @param previous - Previous candle (optional for first candle)
 * @returns True Range value
 */
export function calculateTrueRange(current: Candle, previous?: Candle): number {
  if (!previous) {
    // For the first candle, True Range is simply High - Low
    return current.high - current.low;
  }

  const range1 = current.high - current.low;
  const range2 = Math.abs(current.high - previous.close);
  const range3 = Math.abs(current.low - previous.close);

  return Math.max(range1, range2, range3);
}

/**
 * Calculate True Range for a series of candles
 * 
 * @param candles - Array of candles in chronological order
 * @returns Array of True Range results
 */
export function calculateTrueRangesSeries(candles: Candle[]): TrueRangeResult[] {
  if (!candles || candles.length === 0) {
    return [];
  }

  const results: TrueRangeResult[] = [];

  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    const previous = i > 0 ? candles[i - 1] : undefined;
    
    const trueRange = calculateTrueRange(current, previous);
    
    results.push({
      timestamp: current.timestamp,
      value: trueRange
    });
  }

  return results;
}

/**
 * Calculate Average True Range (ATR) for a series of candles
 * 
 * ATR is the Simple Moving Average of True Range over the specified period
 * 
 * @param candles - Array of candles in chronological order
 * @param period - ATR period (default: 14)
 * @param previousATR - Previous ATR value for incremental calculation (optional)
 * @returns Array of ATR results
 */
export function calculateATR(
  candles: Candle[], 
  period: number = 14, 
  previousATR?: number
): ATRResult[] {
  // Validate inputs
  if (!candles || candles.length === 0) {
    return [];
  }
  
  if (period <= 0) {
    throw new Error('ATR period must be greater than 0');
  }

  // Calculate True Range for all candles
  const trueRanges = calculateTrueRangesSeries(candles);
  
  // If we have insufficient data and no previous ATR, return empty
  if (trueRanges.length < period && previousATR === undefined) {
    return [];
  }

  const results: ATRResult[] = [];
  let atr: number;

  // Initialize ATR
  if (previousATR !== undefined) {
    // Use provided previous ATR for incremental calculation
    atr = previousATR;
  } else {
    // Calculate initial ATR using Simple Moving Average of first 'period' True Ranges
    if (trueRanges.length < period) {
      return [];
    }
    
    const initialSum = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr.value, 0);
    atr = initialSum / period;
    
    // Add the initial ATR value
    results.push({
      timestamp: trueRanges[period - 1].timestamp,
      period,
      value: atr
    });
  }

  // Calculate ATR for remaining candles using smoothed moving average
  // ATR(n) = ((ATR(n-1) * (period - 1)) + TR(n)) / period
  const startIndex = previousATR !== undefined ? 0 : period;
  
  for (let i = startIndex; i < trueRanges.length; i++) {
    const trueRange = trueRanges[i];
    
    // Smoothed moving average formula for ATR
    atr = ((atr * (period - 1)) + trueRange.value) / period;
    
    results.push({
      timestamp: trueRange.timestamp,
      period,
      value: atr
    });
  }

  return results;
}

/**
 * Get the latest ATR value from a series of results
 * 
 * @param atrResults - Array of ATR results
 * @returns Latest ATR value or undefined if no results
 */
export function getLatestATR(atrResults: ATRResult[]): number | undefined {
  if (atrResults.length === 0) {
    return undefined;
  }
  
  return atrResults[atrResults.length - 1].value;
}

/**
 * Validate candle data for ATR calculation
 * 
 * @param candles - Array of candles to validate
 * @returns Array of validation errors
 */
export function validateCandlesForATR(candles: Candle[]): string[] {
  const errors: string[] = [];

  if (!candles || candles.length === 0) {
    errors.push('Candles array is empty or undefined');
    return errors;
  }

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    
    // Validate OHLC relationships
    if (candle.high < candle.low) {
      errors.push(`Candle ${i}: High (${candle.high}) is less than Low (${candle.low})`);
    }
    
    if (candle.high < candle.open || candle.high < candle.close) {
      errors.push(`Candle ${i}: High (${candle.high}) is less than Open (${candle.open}) or Close (${candle.close})`);
    }
    
    if (candle.low > candle.open || candle.low > candle.close) {
      errors.push(`Candle ${i}: Low (${candle.low}) is greater than Open (${candle.open}) or Close (${candle.close})`);
    }
    
    // Validate positive values
    if (candle.high <= 0 || candle.low <= 0 || candle.open <= 0 || candle.close <= 0) {
      errors.push(`Candle ${i}: OHLC values must be positive`);
    }
    
    // Validate volume
    if (candle.volume < 0) {
      errors.push(`Candle ${i}: Volume cannot be negative`);
    }
  }

  return errors;
}