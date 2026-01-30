import type { Candle } from '../types/database.js';
import type { IndicatorData, StrategyConfig } from './strategy.types.js';

export class StrategyValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'StrategyValidationError';
  }
}

export class StrategyCalculationError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'StrategyCalculationError';
  }
}

export class StrategyConfigurationError extends Error {
  constructor(
    message: string,
    public readonly parameter: string,
    public readonly value?: any
  ) {
    super(message);
    this.name = 'StrategyConfigurationError';
  }
}

/**
 * Comprehensive validation utilities for strategy engine
 */
export class StrategyValidator {
  
  /**
   * Validate candle data for strategy processing
   */
  static validateCandle(candle: Candle): string[] {
    const errors: string[] = [];

    if (!candle) {
      errors.push('Candle data is null or undefined');
      return errors;
    }

    // Validate required fields
    if (!candle.pair) {
      errors.push('Candle pair is required');
    }

    if (!candle.timeframe) {
      errors.push('Candle timeframe is required');
    }

    if (!candle.timestamp) {
      errors.push('Candle timestamp is required');
    }

    // Validate OHLC values
    if (typeof candle.open !== 'number' || candle.open <= 0) {
      errors.push('Candle open price must be a positive number');
    }

    if (typeof candle.high !== 'number' || candle.high <= 0) {
      errors.push('Candle high price must be a positive number');
    }

    if (typeof candle.low !== 'number' || candle.low <= 0) {
      errors.push('Candle low price must be a positive number');
    }

    if (typeof candle.close !== 'number' || candle.close <= 0) {
      errors.push('Candle close price must be a positive number');
    }

    if (typeof candle.volume !== 'number' || candle.volume < 0) {
      errors.push('Candle volume must be a non-negative number');
    }

    // Validate OHLC relationships
    if (candle.high < candle.low) {
      errors.push(`High (${candle.high}) cannot be less than Low (${candle.low})`);
    }

    if (candle.high < Math.max(candle.open, candle.close)) {
      errors.push(`High (${candle.high}) cannot be less than Open (${candle.open}) or Close (${candle.close})`);
    }

    if (candle.low > Math.min(candle.open, candle.close)) {
      errors.push(`Low (${candle.low}) cannot be greater than Open (${candle.open}) or Close (${candle.close})`);
    }

    // Validate timestamp is not in future
    const now = new Date();
    if (candle.timestamp > now) {
      errors.push('Candle timestamp cannot be in the future');
    }

    return errors;
  }

  /**
   * Validate indicator data for strategy processing
   */
  static validateIndicatorData(indicators: IndicatorData): string[] {
    const errors: string[] = [];

    if (!indicators) {
      errors.push('Indicator data is null or undefined');
      return errors;
    }

    // Validate EMA values
    if (typeof indicators.ema20 !== 'number' || indicators.ema20 <= 0) {
      errors.push('EMA 20 must be a positive number');
    }

    if (typeof indicators.ema50 !== 'number' || indicators.ema50 <= 0) {
      errors.push('EMA 50 must be a positive number');
    }

    if (typeof indicators.ema200 !== 'number' || indicators.ema200 <= 0) {
      errors.push('EMA 200 must be a positive number');
    }

    // Validate ATR
    if (typeof indicators.atr !== 'number' || indicators.atr <= 0) {
      errors.push('ATR must be a positive number');
    }

    // Validate swing arrays
    if (!Array.isArray(indicators.swingHighs)) {
      errors.push('Swing highs must be an array');
    }

    if (!Array.isArray(indicators.swingLows)) {
      errors.push('Swing lows must be an array');
    }

    // Validate swing points
    indicators.swingHighs?.forEach((swing, index) => {
      const swingErrors = this.validateSwingPoint(swing, 'high', index);
      errors.push(...swingErrors);
    });

    indicators.swingLows?.forEach((swing, index) => {
      const swingErrors = this.validateSwingPoint(swing, 'low', index);
      errors.push(...swingErrors);
    });

    return errors;
  }

  /**
   * Validate swing point data
   */
  private static validateSwingPoint(swing: any, expectedType: 'high' | 'low', index: number): string[] {
    const errors: string[] = [];
    const prefix = `Swing ${expectedType} ${index}`;

    if (!swing) {
      errors.push(`${prefix}: Swing point is null or undefined`);
      return errors;
    }

    if (swing.type !== expectedType) {
      errors.push(`${prefix}: Expected type '${expectedType}', got '${swing.type}'`);
    }

    if (typeof swing.price !== 'number' || swing.price <= 0) {
      errors.push(`${prefix}: Price must be a positive number`);
    }

    if (!swing.timestamp || !(swing.timestamp instanceof Date)) {
      errors.push(`${prefix}: Timestamp must be a valid Date object`);
    }

    if (typeof swing.lookback_periods !== 'number' || swing.lookback_periods <= 0) {
      errors.push(`${prefix}: Lookback periods must be a positive number`);
    }

    return errors;
  }

  /**
   * Validate strategy configuration
   */
  static validateConfig(config: StrategyConfig): string[] {
    const errors: string[] = [];

    if (!config) {
      errors.push('Strategy configuration is null or undefined');
      return errors;
    }

    // Validate pair and timeframe
    if (!config.pair || typeof config.pair !== 'string') {
      errors.push('Pair must be a non-empty string');
    }

    if (!config.timeframe || typeof config.timeframe !== 'string') {
      errors.push('Timeframe must be a non-empty string');
    }

    // Validate trading window
    if (!config.tradingWindow) {
      errors.push('Trading window configuration is required');
    } else {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      
      if (!timeRegex.test(config.tradingWindow.start)) {
        errors.push('Trading window start must be in HH:MM format');
      }

      if (!timeRegex.test(config.tradingWindow.end)) {
        errors.push('Trading window end must be in HH:MM format');
      }

      if (!config.tradingWindow.timezone) {
        errors.push('Trading window timezone is required');
      }
    }

    // Validate risk parameters
    if (!config.risk) {
      errors.push('Risk configuration is required');
    } else {
      if (config.risk.riskPerTrade <= 0 || config.risk.riskPerTrade > 0.1) {
        errors.push('Risk per trade must be between 0 and 0.1 (10%)');
      }

      if (config.risk.maxConcurrentTrades <= 0) {
        errors.push('Max concurrent trades must be positive');
      }

      if (config.risk.leverage <= 0 || config.risk.leverage > 500) {
        errors.push('Leverage must be between 1 and 500');
      }

      if (config.risk.minRRRatio < 1) {
        errors.push('Minimum RR ratio must be at least 1');
      }

      if (config.risk.accountBalance <= 0) {
        errors.push('Account balance must be positive');
      }
    }

    // Validate confidence parameters
    if (!config.confidence) {
      errors.push('Confidence configuration is required');
    } else {
      if (config.confidence.minThreshold < 0 || config.confidence.minThreshold > 1) {
        errors.push('Confidence threshold must be between 0 and 1');
      }

      if (!config.confidence.components) {
        errors.push('Confidence components configuration is required');
      } else {
        const weights = Object.values(config.confidence.components);
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        
        if (Math.abs(totalWeight - 1.0) > 0.001) {
          errors.push('Confidence component weights must sum to 1.0');
        }

        weights.forEach(weight => {
          if (weight < 0 || weight > 1) {
            errors.push('All confidence component weights must be between 0 and 1');
          }
        });
      }
    }

    return errors;
  }

  /**
   * Validate numerical calculations for safety
   */
  static validateCalculation(
    value: number,
    name: string,
    min?: number,
    max?: number
  ): void {
    if (typeof value !== 'number') {
      throw new StrategyCalculationError(
        `${name} must be a number`,
        'CALCULATION',
        { value, type: typeof value }
      );
    }

    if (isNaN(value)) {
      throw new StrategyCalculationError(
        `${name} calculation resulted in NaN`,
        'CALCULATION',
        { value }
      );
    }

    if (!isFinite(value)) {
      throw new StrategyCalculationError(
        `${name} calculation resulted in infinite value`,
        'CALCULATION',
        { value }
      );
    }

    if (min !== undefined && value < min) {
      throw new StrategyCalculationError(
        `${name} (${value}) is below minimum (${min})`,
        'CALCULATION',
        { value, min }
      );
    }

    if (max !== undefined && value > max) {
      throw new StrategyCalculationError(
        `${name} (${value}) exceeds maximum (${max})`,
        'CALCULATION',
        { value, max }
      );
    }
  }

  /**
   * Validate division operations to prevent division by zero
   */
  static safeDivide(numerator: number, denominator: number, name: string): number {
    this.validateCalculation(numerator, `${name} numerator`);
    this.validateCalculation(denominator, `${name} denominator`);

    if (denominator === 0) {
      throw new StrategyCalculationError(
        `Division by zero in ${name} calculation`,
        'DIVISION_BY_ZERO',
        { numerator, denominator }
      );
    }

    const result = numerator / denominator;
    this.validateCalculation(result, `${name} result`);
    
    return result;
  }

  /**
   * Validate percentage calculations
   */
  static validatePercentage(value: number, name: string): void {
    this.validateCalculation(value, name, 0, 1);
  }

  /**
   * Validate price values
   */
  static validatePrice(price: number, name: string): void {
    this.validateCalculation(price, name, 0.01); // Minimum price of 1 cent
  }

  /**
   * Validate position size
   */
  static validatePositionSize(size: number): void {
    this.validateCalculation(size, 'Position size', 0);
    
    // Check for reasonable position size limits
    if (size > 1000) {
      throw new StrategyCalculationError(
        `Position size (${size}) exceeds reasonable limit (1000)`,
        'CALCULATION',
        { size }
      );
    }
  }

  /**
   * Validate margin calculations
   */
  static validateMargin(margin: number, accountBalance: number): void {
    this.validateCalculation(margin, 'Margin', 0);
    this.validateCalculation(accountBalance, 'Account balance', 0);

    if (margin > accountBalance) {
      throw new StrategyCalculationError(
        `Margin requirement (${margin}) exceeds account balance (${accountBalance})`,
        'INSUFFICIENT_MARGIN',
        { margin, accountBalance }
      );
    }
  }

  /**
   * Validate timestamp chronology
   */
  static validateTimestamp(timestamp: Date, name: string): void {
    if (!(timestamp instanceof Date)) {
      throw new StrategyValidationError(
        `${name} must be a Date object`,
        'INVALID_TIMESTAMP',
        { timestamp, type: typeof timestamp }
      );
    }

    if (isNaN(timestamp.getTime())) {
      throw new StrategyValidationError(
        `${name} is an invalid Date`,
        'INVALID_TIMESTAMP',
        { timestamp }
      );
    }

    // Check if timestamp is too far in the future (more than 1 hour)
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
    
    if (timestamp > maxFuture) {
      throw new StrategyValidationError(
        `${name} is too far in the future`,
        'FUTURE_TIMESTAMP',
        { timestamp, maxFuture }
      );
    }
  }

  /**
   * Validate array bounds and access
   */
  static validateArrayAccess<T>(array: T[], index: number, name: string): T {
    if (!Array.isArray(array)) {
      throw new StrategyValidationError(
        `${name} must be an array`,
        'INVALID_ARRAY',
        { array, type: typeof array }
      );
    }

    if (index < 0 || index >= array.length) {
      throw new StrategyValidationError(
        `Array index ${index} out of bounds for ${name} (length: ${array.length})`,
        'ARRAY_OUT_OF_BOUNDS',
        { index, length: array.length }
      );
    }

    return array[index];
  }

  /**
   * Create validation summary
   */
  static createValidationSummary(
    candle: Candle,
    indicators: IndicatorData,
    config: StrategyConfig
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate all components
    try {
      errors.push(...this.validateCandle(candle));
      errors.push(...this.validateIndicatorData(indicators));
      errors.push(...this.validateConfig(config));

      // Add warnings for edge cases
      if (indicators.atr > indicators.ema20 * 0.05) {
        warnings.push('High ATR relative to EMA20 may indicate excessive volatility');
      }

      if (Math.abs(indicators.ema20 - indicators.ema50) / indicators.ema50 < 0.001) {
        warnings.push('EMA20 and EMA50 are very close, may indicate ranging market');
      }

      if (indicators.swingHighs.length < 3 || indicators.swingLows.length < 3) {
        warnings.push('Limited swing data may affect structure analysis quality');
      }

    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}