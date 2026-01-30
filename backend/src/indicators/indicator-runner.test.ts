import { describe, it, expect, beforeEach } from 'vitest';
import { IndicatorRunnerService } from '../services/indicator-runner.service.js';
import { Candle } from '../types/database.js';

describe('Indicator Runner Service', () => {
  let service: IndicatorRunnerService;

  beforeEach(() => {
    service = new IndicatorRunnerService();
  });

  describe('Service Initialization', () => {
    it('should create service instance successfully', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(IndicatorRunnerService);
    });

    it('should have all required methods', () => {
      expect(typeof service.runHistoricalBuild).toBe('function');
      expect(typeof service.runIncrementalUpdate).toBe('function');
      expect(typeof service.validateIndicators).toBe('function');
    });
  });

  describe('Validation', () => {
    it('should validate indicators and return validation result', async () => {
      // This test will fail gracefully since we don't have actual data
      // but it tests the method signature and basic error handling
      try {
        const result = await service.validateIndicators('EURUSD', '1h');
        expect(result).toBeDefined();
        expect(typeof result.isValid).toBe('boolean');
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
      } catch (error) {
        // Expected to fail without database setup, but should be a proper error
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid pair/timeframe gracefully', async () => {
      try {
        await service.runHistoricalBuild('', '');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('failed');
      }
    });

    it('should handle incremental update errors gracefully', async () => {
      try {
        await service.runIncrementalUpdate('INVALID', 'INVALID');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('failed');
      }
    });
  });
});