import fc from 'fast-check';
import { Candle } from '../types/database.js';

// Generator for valid OHLCV candle data
export const candleArbitrary = fc.record({
  pair: fc.constantFrom('EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'),
  timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '4h', '1d'),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }),
  open: fc.float({ min: 0.1, max: 10000, noNaN: true }),
  high: fc.float({ min: 0.1, max: 10000, noNaN: true }),
  low: fc.float({ min: 0.1, max: 10000, noNaN: true }),
  close: fc.float({ min: 0.1, max: 10000, noNaN: true }),
  volume: fc.float({ min: 0, max: 1000000, noNaN: true })
}).map((candle): Candle => {
  // Ensure OHLC relationships are valid
  const prices = [candle.open, candle.high, candle.low, candle.close].sort((a, b) => a - b);
  const [minPrice, , , maxPrice] = prices;
  
  return {
    ...candle,
    // Ensure OHLC relationships are valid
    high: Math.max(candle.open, candle.close, candle.high),
    low: Math.min(candle.open, candle.close, candle.low)
  };
});

// Generator for sequences of chronologically ordered candles
export const candleSequenceArbitrary = (minLength: number = 1, maxLength: number = 100) =>
  fc.array(candleArbitrary, { minLength, maxLength })
    .map(candles => {
      // Sort by timestamp and ensure same pair/timeframe
      const sortedCandles = candles
        .map((candle, index) => ({
          ...candle,
          pair: 'EURUSD', // Use consistent pair for sequences
          timeframe: '1h', // Use consistent timeframe for sequences
          timestamp: new Date(Date.now() + index * 3600000) // 1 hour intervals
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      return sortedCandles;
    });

// Generator for edge case scenarios
export const edgeCaseArbitrary = fc.oneof(
  // Empty array
  fc.constant([]),
  // Single candle
  fc.array(candleArbitrary, { minLength: 1, maxLength: 1 }),
  // Insufficient data for calculations
  fc.array(candleArbitrary, { minLength: 2, maxLength: 5 })
);

// Test configuration
export const testConfig = {
  numRuns: 100, // Minimum 100 iterations as specified in design
  timeout: 30000, // 30 second timeout
  verbose: false
};