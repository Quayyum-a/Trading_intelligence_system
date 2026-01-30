import type { Candle } from '../types/database.js';
import type { EMAResult } from './indicator.interface.js';

/**
 * Calculate Exponential Moving Average (EMA) for a series of candles
 * 
 * Formula: EMA = (Close × α) + (Previous EMA × (1 - α))
 * Where α = 2 / (period + 1)
 * 
 * @param candles - Array of candles in chronological order
 * @param period - EMA period (20, 50, or 200)
 * @param previousEMA - Previous EMA value for incremental calculation (optional)
 * @returns Array of EMA results
 */
export function calculateEMA(
  candles: Candle[], 
  period: number, 
  previousEMA?: number
): EMAResult[] {
  // Validate inputs
  if (!candles || candles.length === 0) {
    return [];
  }
  
  if (period <= 0) {
    throw new Error('EMA period must be greater than 0');
  }

  // Validate supported periods
  const supportedPeriods = [20, 50, 200];
  if (!supportedPeriods.includes(period)) {
    throw new Error(`EMA period must be one of: ${supportedPeriods.join(', ')}`);
  }

  // Calculate smoothing factor
  const alpha = 2 / (period + 1);
  const results: EMAResult[] = [];

  // If we have insufficient data and no previous EMA, return empty
  if (candles.length < period && previousEMA === undefined) {
    return [];
  }

  let ema: number;

  // Initialize EMA
  if (previousEMA !== undefined) {
    // Use provided previous EMA for incremental calculation
    ema = previousEMA;
  } else {
    // Calculate initial EMA using Simple Moving Average of first 'period' candles
    if (candles.length < period) {
      return [];
    }
    
    const initialSum = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0);
    ema = initialSum / period;
    
    // Add the initial SMA as the first EMA value
    results.push({
      timestamp: candles[period - 1].timestamp,
      period,
      value: ema
    });
  }

  // Calculate EMA for remaining candles
  const startIndex = previousEMA !== undefined ? 0 : period;
  
  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    
    // EMA formula: EMA = (Close × α) + (Previous EMA × (1 - α))
    ema = (candle.close * alpha) + (ema * (1 - alpha));
    
    results.push({
      timestamp: candle.timestamp,
      period,
      value: ema
    });
  }

  return results;

  return results;
}

/**
 * Calculate EMA for multiple periods (20, 50, 200)
 * 
 * @param candles - Array of candles in chronological order
 * @param previousEMAs - Map of previous EMA values by period for incremental calculation
 * @returns Map of EMA results by period
 */
export function calculateMultiPeriodEMA(
  candles: Candle[],
  previousEMAs?: Map<number, number>
): Map<number, EMAResult[]> {
  const periods = [20, 50, 200];
  const results = new Map<number, EMAResult[]>();

  for (const period of periods) {
    const previousEMA = previousEMAs?.get(period);
    const emaResults = calculateEMA(candles, period, previousEMA);
    results.set(period, emaResults);
  }

  return results;
}

/**
 * Get the latest EMA value from a series of results
 * 
 * @param emaResults - Array of EMA results
 * @returns Latest EMA value or undefined if no results
 */
export function getLatestEMA(emaResults: EMAResult[]): number | undefined {
  if (emaResults.length === 0) {
    return undefined;
  }
  
  return emaResults[emaResults.length - 1].value;
}