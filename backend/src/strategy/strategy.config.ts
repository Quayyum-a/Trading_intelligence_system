import type { StrategyConfig } from './strategy.types.js';

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  pair: 'XAU/USD',
  timeframe: '15M',
  tradingWindow: {
    start: '14:00',
    end: '18:00',
    timezone: 'UTC'
  },
  risk: {
    riskPerTrade: 0.01, // 1%
    maxConcurrentTrades: 1,
    leverage: 200,
    minRRRatio: 2.0,
    accountBalance: 10000 // Default account balance
  },
  confidence: {
    minThreshold: 0.7,
    components: {
      emaAlignment: 0.25,
      structureQuality: 0.25,
      atrContext: 0.15,
      timeOfDay: 0.15,
      rrQuality: 0.20
    }
  },
  regime: {
    emaAlignmentWeight: 0.6,
    swingStructureWeight: 0.4,
    atrVolatilityThreshold: 2.0 // ATR multiplier for high volatility
  },
  setup: {
    pullbackToleranceATR: 0.5,
    breakoutConfirmationATR: 1.0,
    sweepToleranceATR: 0.3
  }
};

/**
 * Validate strategy configuration
 */
export function validateStrategyConfig(config: StrategyConfig): string[] {
  const errors: string[] = [];

  // Validate risk parameters
  if (config.risk.riskPerTrade <= 0 || config.risk.riskPerTrade > 0.1) {
    errors.push('Risk per trade must be between 0 and 0.1 (10%)');
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

  // Validate confidence parameters
  if (config.confidence.minThreshold < 0 || config.confidence.minThreshold > 1) {
    errors.push('Confidence threshold must be between 0 and 1');
  }

  const weightSum = Object.values(config.confidence.components).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    errors.push('Confidence component weights must sum to 1.0');
  }

  // Validate trading window
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(config.tradingWindow.start)) {
    errors.push('Trading window start time must be in HH:MM format');
  }

  if (!timeRegex.test(config.tradingWindow.end)) {
    errors.push('Trading window end time must be in HH:MM format');
  }

  return errors;
}

/**
 * Load strategy configuration from environment variables
 */
export function loadConfigFromEnv(): Partial<StrategyConfig> {
  const config: Partial<StrategyConfig> = {};

  if (process.env.STRATEGY_PAIR) {
    config.pair = process.env.STRATEGY_PAIR;
  }

  if (process.env.STRATEGY_TIMEFRAME) {
    config.timeframe = process.env.STRATEGY_TIMEFRAME;
  }

  if (process.env.STRATEGY_RISK_PER_TRADE) {
    const riskPerTrade = parseFloat(process.env.STRATEGY_RISK_PER_TRADE);
    if (!isNaN(riskPerTrade)) {
      config.risk = { ...DEFAULT_STRATEGY_CONFIG.risk, riskPerTrade };
    }
  }

  if (process.env.STRATEGY_ACCOUNT_BALANCE) {
    const accountBalance = parseFloat(process.env.STRATEGY_ACCOUNT_BALANCE);
    if (!isNaN(accountBalance)) {
      config.risk = { ...config.risk, ...DEFAULT_STRATEGY_CONFIG.risk, accountBalance };
    }
  }

  if (process.env.STRATEGY_CONFIDENCE_THRESHOLD) {
    const minThreshold = parseFloat(process.env.STRATEGY_CONFIDENCE_THRESHOLD);
    if (!isNaN(minThreshold)) {
      config.confidence = { ...DEFAULT_STRATEGY_CONFIG.confidence, minThreshold };
    }
  }

  return config;
}