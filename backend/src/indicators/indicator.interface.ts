import type { Candle } from '../types/database.js';

// Base indicator interface
export interface IndicatorValue {
  candleId?: string; // Optional for backward compatibility
  pair: string;
  timeframe: string;
  timestamp: Date;
}

// EMA specific interface
export interface EMAValue extends IndicatorValue {
  period: number;
  value: number;
}

// ATR specific interface
export interface ATRValue extends IndicatorValue {
  period: number;
  value: number;
}

// Swing point interface
export interface SwingPoint extends IndicatorValue {
  type: 'high' | 'low';
  price: number;
  lookback_periods: number;
}

// Indicator calculation context
export interface IndicatorContext {
  candles: Candle[];
  previousValues?: IndicatorValue[];
}

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// EMA calculation result
export interface EMAResult {
  timestamp: Date;
  period: number;
  value: number;
}

// ATR calculation result
export interface ATRResult {
  timestamp: Date;
  period: number;
  value: number;
}

// True Range calculation result
export interface TrueRangeResult {
  timestamp: Date;
  value: number;
}