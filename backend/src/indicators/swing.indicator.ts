import { Candle } from '../types/database.js';
import { SwingPoint } from './indicator.interface.js';

/**
 * Detect swing highs and swing lows in a series of candles
 * 
 * Swing High: A high that is higher than N candles to the left and right
 * Swing Low: A low that is lower than N candles to the left and right
 * 
 * Uses a fixed lookback window to prevent repainting
 * 
 * @param candles - Array of candles in chronological order
 * @param lookbackPeriods - Number of periods to look left and right (default: 5)
 * @returns Array of detected swing points
 */
export function detectSwings(
  candles: Candle[], 
  lookbackPeriods: number = 5
): SwingPoint[] {
  // Validate inputs
  if (!candles || candles.length === 0) {
    return [];
  }
  
  if (lookbackPeriods <= 0) {
    throw new Error('Lookback periods must be greater than 0');
  }

  // Need at least (2 * lookbackPeriods + 1) candles to detect swings
  const minCandles = (2 * lookbackPeriods) + 1;
  if (candles.length < minCandles) {
    return [];
  }

  const swingPoints: SwingPoint[] = [];

  // Iterate through candles, excluding the edges where we can't look both ways
  for (let i = lookbackPeriods; i < candles.length - lookbackPeriods; i++) {
    const currentCandle = candles[i];
    
    // Check for swing high
    if (isSwingHigh(candles, i, lookbackPeriods)) {
      swingPoints.push({
        pair: currentCandle.pair,
        timeframe: currentCandle.timeframe,
        timestamp: currentCandle.timestamp,
        type: 'high',
        price: currentCandle.high,
        lookback_periods: lookbackPeriods
      });
    }
    
    // Check for swing low
    if (isSwingLow(candles, i, lookbackPeriods)) {
      swingPoints.push({
        pair: currentCandle.pair,
        timeframe: currentCandle.timeframe,
        timestamp: currentCandle.timestamp,
        type: 'low',
        price: currentCandle.low,
        lookback_periods: lookbackPeriods
      });
    }
  }

  return swingPoints;
}

/**
 * Check if a candle at the given index is a swing high
 * 
 * @param candles - Array of candles
 * @param index - Index of the candle to check
 * @param lookbackPeriods - Number of periods to look left and right
 * @returns True if the candle is a swing high
 */
export function isSwingHigh(
  candles: Candle[], 
  index: number, 
  lookbackPeriods: number
): boolean {
  if (index < lookbackPeriods || index >= candles.length - lookbackPeriods) {
    return false;
  }

  const currentHigh = candles[index].high;

  // Check left side
  for (let i = index - lookbackPeriods; i < index; i++) {
    if (candles[i].high >= currentHigh) {
      return false;
    }
  }

  // Check right side
  for (let i = index + 1; i <= index + lookbackPeriods; i++) {
    if (candles[i].high >= currentHigh) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a candle at the given index is a swing low
 * 
 * @param candles - Array of candles
 * @param index - Index of the candle to check
 * @param lookbackPeriods - Number of periods to look left and right
 * @returns True if the candle is a swing low
 */
export function isSwingLow(
  candles: Candle[], 
  index: number, 
  lookbackPeriods: number
): boolean {
  if (index < lookbackPeriods || index >= candles.length - lookbackPeriods) {
    return false;
  }

  const currentLow = candles[index].low;

  // Check left side
  for (let i = index - lookbackPeriods; i < index; i++) {
    if (candles[i].low <= currentLow) {
      return false;
    }
  }

  // Check right side
  for (let i = index + 1; i <= index + lookbackPeriods; i++) {
    if (candles[i].low <= currentLow) {
      return false;
    }
  }

  return true;
}

/**
 * Detect swing points with multiple lookback periods
 * 
 * @param candles - Array of candles in chronological order
 * @param lookbackPeriods - Array of lookback periods to use
 * @returns Map of swing points by lookback period
 */
export function detectMultiPeriodSwings(
  candles: Candle[],
  lookbackPeriods: number[] = [3, 5, 8, 13]
): Map<number, SwingPoint[]> {
  const results = new Map<number, SwingPoint[]>();

  for (const period of lookbackPeriods) {
    const swingPoints = detectSwings(candles, period);
    results.set(period, swingPoints);
  }

  return results;
}

/**
 * Filter swing points by type
 * 
 * @param swingPoints - Array of swing points
 * @param type - Type to filter by ('high' or 'low')
 * @returns Filtered array of swing points
 */
export function filterSwingsByType(
  swingPoints: SwingPoint[], 
  type: 'high' | 'low'
): SwingPoint[] {
  return swingPoints.filter(point => point.type === type);
}

/**
 * Get the most recent swing points
 * 
 * @param swingPoints - Array of swing points
 * @param count - Number of recent swing points to return
 * @returns Array of most recent swing points
 */
export function getRecentSwings(
  swingPoints: SwingPoint[], 
  count: number = 10
): SwingPoint[] {
  return swingPoints
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, count);
}

/**
 * Validate candle data for swing detection
 * 
 * @param candles - Array of candles to validate
 * @param lookbackPeriods - Lookback periods to validate against
 * @returns Array of validation errors
 */
export function validateCandlesForSwing(
  candles: Candle[], 
  lookbackPeriods: number
): string[] {
  const errors: string[] = [];

  if (!candles || candles.length === 0) {
    errors.push('Candles array is empty or undefined');
    return errors;
  }

  const minCandles = (2 * lookbackPeriods) + 1;
  if (candles.length < minCandles) {
    errors.push(`Insufficient candles for swing detection. Need at least ${minCandles} candles for lookback period ${lookbackPeriods}`);
  }

  // Check chronological order
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].timestamp <= candles[i - 1].timestamp) {
      errors.push(`Candles are not in chronological order at index ${i}`);
    }
  }

  // Validate OHLC relationships
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    
    if (candle.high < candle.low) {
      errors.push(`Candle ${i}: High (${candle.high}) is less than Low (${candle.low})`);
    }
    
    if (candle.high < Math.max(candle.open, candle.close)) {
      errors.push(`Candle ${i}: High (${candle.high}) is less than max of Open/Close`);
    }
    
    if (candle.low > Math.min(candle.open, candle.close)) {
      errors.push(`Candle ${i}: Low (${candle.low}) is greater than min of Open/Close`);
    }
  }

  return errors;
}