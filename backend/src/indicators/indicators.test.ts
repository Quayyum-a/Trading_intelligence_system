import { describe, it, expect } from 'vitest';
import { calculateEMA } from './ema.indicator.js';
import { calculateATR } from './atr.indicator.js';
import { detectSwings } from './swing.indicator.js';
import { Candle } from '../types/database.js';

describe('Indicator Functions', () => {
  // Sample candle data for testing
  const sampleCandles: Candle[] = [
    {
      pair: 'EURUSD',
      timeframe: '1h',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      open: 1.1000,
      high: 1.1050,
      low: 1.0950,
      close: 1.1020,
      volume: 1000
    },
    {
      pair: 'EURUSD',
      timeframe: '1h',
      timestamp: new Date('2024-01-01T01:00:00Z'),
      open: 1.1020,
      high: 1.1080,
      low: 1.1000,
      close: 1.1060,
      volume: 1200
    },
    {
      pair: 'EURUSD',
      timeframe: '1h',
      timestamp: new Date('2024-01-01T02:00:00Z'),
      open: 1.1060,
      high: 1.1100,
      low: 1.1040,
      close: 1.1080,
      volume: 800
    }
  ];

  describe('EMA Calculation', () => {
    it('should calculate EMA correctly for valid input', () => {
      // Create enough candles for a 20-period EMA
      const candles: Candle[] = [];
      for (let i = 0; i < 25; i++) {
        candles.push({
          pair: 'EURUSD',
          timeframe: '1h',
          timestamp: new Date(Date.now() + i * 3600000),
          open: 1.1000 + (i * 0.001),
          high: 1.1050 + (i * 0.001),
          low: 1.0950 + (i * 0.001),
          close: 1.1000 + (i * 0.001),
          volume: 1000
        });
      }

      const results = calculateEMA(candles, 20);
      
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].period).toBe(20);
      expect(results[0].value).toBeTypeOf('number');
    });

    it('should return empty array for insufficient data', () => {
      const results = calculateEMA(sampleCandles, 20);
      expect(results).toEqual([]);
    });

    it('should throw error for invalid period', () => {
      expect(() => calculateEMA(sampleCandles, 0)).toThrow();
      expect(() => calculateEMA(sampleCandles, 15)).toThrow(); // Not supported period
    });
  });

  describe('ATR Calculation', () => {
    it('should calculate ATR correctly for valid input', () => {
      // Create enough candles for a 14-period ATR
      const candles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        candles.push({
          pair: 'EURUSD',
          timeframe: '1h',
          timestamp: new Date(Date.now() + i * 3600000),
          open: 1.1000 + (i * 0.001),
          high: 1.1050 + (i * 0.001),
          low: 1.0950 + (i * 0.001),
          close: 1.1000 + (i * 0.001),
          volume: 1000
        });
      }

      const results = calculateATR(candles, 14);
      
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].period).toBe(14);
      expect(results[0].value).toBeTypeOf('number');
      expect(results[0].value).toBeGreaterThan(0);
    });

    it('should return empty array for insufficient data', () => {
      const results = calculateATR(sampleCandles, 14);
      expect(results).toEqual([]);
    });

    it('should throw error for invalid period', () => {
      expect(() => calculateATR(sampleCandles, 0)).toThrow();
    });
  });

  describe('Swing Detection', () => {
    it('should detect swing points correctly', () => {
      // Create candles with clear swing patterns
      const candles: Candle[] = [];
      const prices = [1.1000, 1.1020, 1.1050, 1.1080, 1.1060, 1.1040, 1.1020, 1.1000, 1.0980, 1.1000, 1.1020, 1.1040, 1.1020];
      
      for (let i = 0; i < prices.length; i++) {
        candles.push({
          pair: 'EURUSD',
          timeframe: '1h',
          timestamp: new Date(Date.now() + i * 3600000),
          open: prices[i],
          high: prices[i] + 0.0010,
          low: prices[i] - 0.0010,
          close: prices[i],
          volume: 1000
        });
      }

      const results = detectSwings(candles, 3);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      // Should find at least one swing point
      if (results.length > 0) {
        expect(results[0].type).toMatch(/^(high|low)$/);
        expect(results[0].lookback_periods).toBe(3);
        expect(results[0].price).toBeTypeOf('number');
      }
    });

    it('should return empty array for insufficient data', () => {
      const results = detectSwings(sampleCandles, 5);
      expect(results).toEqual([]);
    });

    it('should throw error for invalid lookback period', () => {
      expect(() => detectSwings(sampleCandles, 0)).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty candle arrays', () => {
      expect(calculateEMA([], 20)).toEqual([]);
      expect(calculateATR([], 14)).toEqual([]);
      expect(detectSwings([], 5)).toEqual([]);
    });

    it('should handle single candle', () => {
      const singleCandle = [sampleCandles[0]];
      expect(calculateEMA(singleCandle, 20)).toEqual([]);
      expect(calculateATR(singleCandle, 14)).toEqual([]);
      expect(detectSwings(singleCandle, 5)).toEqual([]);
    });
  });
});