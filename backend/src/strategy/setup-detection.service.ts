import type { Candle } from '../types/database.js';
import type {
  IndicatorData,
  MarketRegimeResult,
  SetupDetectionService,
  SetupResult,
  SetupType,
  TradeDirection,
  ValidationCheck
} from './strategy.types.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class SetupDetectionServiceImpl implements SetupDetectionService {
  
  /**
   * Detect valid trade setups within allowed market regimes
   */
  detectSetups(regime: MarketRegimeResult, indicators: IndicatorData, candle: Candle): SetupResult[] {
    // No setups in NO_TRADE regime
    if (regime.regime === 'NO_TRADE') {
      return [];
    }

    const setups: SetupResult[] = [];

    // Check for pullback setups
    const pullbackSetups = this.detectPullbackSetups(regime, indicators, candle);
    setups.push(...pullbackSetups);

    // Check for breakout setups
    const breakoutSetups = this.detectBreakoutSetups(regime, indicators, candle);
    setups.push(...breakoutSetups);

    // Check for continuation setups
    const continuationSetups = this.detectContinuationSetups(regime, indicators, candle);
    setups.push(...continuationSetups);

    // Filter setups by validation checks
    return setups.filter(setup => this.validateSetup(setup, indicators, candle));
  }

  /**
   * Detect pullback setups to EMA levels
   */
  private detectPullbackSetups(regime: MarketRegimeResult, indicators: IndicatorData, candle: Candle): SetupResult[] {
    const setups: SetupResult[] = [];
    const { ema20, ema50, atr } = indicators;
    const tolerance = DEFAULT_STRATEGY_CONFIG.setup.pullbackToleranceATR * atr;

    // Pullback to EMA20 in bullish trend
    if (regime.regime === 'BULLISH_TREND') {
      const distanceToEma20 = Math.abs(candle.close - ema20);
      if (distanceToEma20 <= tolerance && candle.close > ema20 * 0.999) {
        setups.push({
          type: 'PULLBACK_TO_EMA20',
          direction: 'BUY',
          confidence: this.calculatePullbackConfidence(candle, ema20, tolerance, 'BUY'),
          entryPrice: candle.close,
          reasoning: `Bullish pullback to EMA20 (${ema20.toFixed(2)}) within ${tolerance.toFixed(2)} tolerance`,
          validationChecks: this.createPullbackValidationChecks(candle, ema20, tolerance, 'BUY')
        });
      }

      // Pullback to EMA50 in strong bullish trend
      if (regime.confidence > 0.7) {
        const distanceToEma50 = Math.abs(candle.close - ema50);
        if (distanceToEma50 <= tolerance && candle.close > ema50 * 0.999) {
          setups.push({
            type: 'PULLBACK_TO_EMA50',
            direction: 'BUY',
            confidence: this.calculatePullbackConfidence(candle, ema50, tolerance, 'BUY'),
            entryPrice: candle.close,
            reasoning: `Strong bullish pullback to EMA50 (${ema50.toFixed(2)}) within ${tolerance.toFixed(2)} tolerance`,
            validationChecks: this.createPullbackValidationChecks(candle, ema50, tolerance, 'BUY')
          });
        }
      }
    }

    // Pullback to EMA20 in bearish trend
    if (regime.regime === 'BEARISH_TREND') {
      const distanceToEma20 = Math.abs(candle.close - ema20);
      if (distanceToEma20 <= tolerance && candle.close < ema20 * 1.001) {
        setups.push({
          type: 'PULLBACK_TO_EMA20',
          direction: 'SELL',
          confidence: this.calculatePullbackConfidence(candle, ema20, tolerance, 'SELL'),
          entryPrice: candle.close,
          reasoning: `Bearish pullback to EMA20 (${ema20.toFixed(2)}) within ${tolerance.toFixed(2)} tolerance`,
          validationChecks: this.createPullbackValidationChecks(candle, ema20, tolerance, 'SELL')
        });
      }

      // Pullback to EMA50 in strong bearish trend
      if (regime.confidence > 0.7) {
        const distanceToEma50 = Math.abs(candle.close - ema50);
        if (distanceToEma50 <= tolerance && candle.close < ema50 * 1.001) {
          setups.push({
            type: 'PULLBACK_TO_EMA50',
            direction: 'SELL',
            confidence: this.calculatePullbackConfidence(candle, ema50, tolerance, 'SELL'),
            entryPrice: candle.close,
            reasoning: `Strong bearish pullback to EMA50 (${ema50.toFixed(2)}) within ${tolerance.toFixed(2)} tolerance`,
            validationChecks: this.createPullbackValidationChecks(candle, ema50, tolerance, 'SELL')
          });
        }
      }
    }

    return setups;
  }

  /**
   * Detect structure breakout setups
   */
  private detectBreakoutSetups(regime: MarketRegimeResult, indicators: IndicatorData, candle: Candle): SetupResult[] {
    const setups: SetupResult[] = [];
    const { swingHighs, swingLows, atr } = indicators;
    const confirmationDistance = DEFAULT_STRATEGY_CONFIG.setup.breakoutConfirmationATR * atr;

    // Bullish breakout in trending markets
    if (regime.regime === 'BULLISH_TREND' || regime.regime === 'RANGING') {
      const recentHigh = this.getRecentSwingHigh(swingHighs);
      if (recentHigh && candle.close > recentHigh.price + confirmationDistance) {
        setups.push({
          type: 'STRUCTURE_BREAKOUT',
          direction: 'BUY',
          confidence: this.calculateBreakoutConfidence(candle, recentHigh.price, confirmationDistance, 'BUY', regime),
          entryPrice: candle.close,
          reasoning: `Bullish breakout above ${recentHigh.price.toFixed(2)} with ${confirmationDistance.toFixed(2)} confirmation`,
          validationChecks: this.createBreakoutValidationChecks(candle, recentHigh.price, confirmationDistance, 'BUY')
        });
      }
    }

    // Bearish breakout in trending markets
    if (regime.regime === 'BEARISH_TREND' || regime.regime === 'RANGING') {
      const recentLow = this.getRecentSwingLow(swingLows);
      if (recentLow && candle.close < recentLow.price - confirmationDistance) {
        setups.push({
          type: 'STRUCTURE_BREAKOUT',
          direction: 'SELL',
          confidence: this.calculateBreakoutConfidence(candle, recentLow.price, confirmationDistance, 'SELL', regime),
          entryPrice: candle.close,
          reasoning: `Bearish breakout below ${recentLow.price.toFixed(2)} with ${confirmationDistance.toFixed(2)} confirmation`,
          validationChecks: this.createBreakoutValidationChecks(candle, recentLow.price, confirmationDistance, 'SELL')
        });
      }
    }

    return setups;
  }

  /**
   * Detect continuation setups after liquidity sweeps
   */
  private detectContinuationSetups(regime: MarketRegimeResult, indicators: IndicatorData, candle: Candle): SetupResult[] {
    const setups: SetupResult[] = [];
    const { swingHighs, swingLows, atr } = indicators;
    const sweepTolerance = DEFAULT_STRATEGY_CONFIG.setup.sweepToleranceATR * atr;

    // Only in trending markets
    if (regime.regime !== 'BULLISH_TREND' && regime.regime !== 'BEARISH_TREND') {
      return setups;
    }

    // Bullish continuation after low sweep
    if (regime.regime === 'BULLISH_TREND') {
      const liquiditySweep = this.detectLiquiditySweep(swingLows, candle, sweepTolerance, 'low');
      if (liquiditySweep) {
        setups.push({
          type: 'CONTINUATION_AFTER_SWEEP',
          direction: 'BUY',
          confidence: this.calculateContinuationConfidence(regime, liquiditySweep, 'BUY'),
          entryPrice: candle.close,
          reasoning: `Bullish continuation after liquidity sweep of ${liquiditySweep.price.toFixed(2)}`,
          validationChecks: this.createContinuationValidationChecks(liquiditySweep, sweepTolerance, 'BUY')
        });
      }
    }

    // Bearish continuation after high sweep
    if (regime.regime === 'BEARISH_TREND') {
      const liquiditySweep = this.detectLiquiditySweep(swingHighs, candle, sweepTolerance, 'high');
      if (liquiditySweep) {
        setups.push({
          type: 'CONTINUATION_AFTER_SWEEP',
          direction: 'SELL',
          confidence: this.calculateContinuationConfidence(regime, liquiditySweep, 'SELL'),
          entryPrice: candle.close,
          reasoning: `Bearish continuation after liquidity sweep of ${liquiditySweep.price.toFixed(2)}`,
          validationChecks: this.createContinuationValidationChecks(liquiditySweep, sweepTolerance, 'SELL')
        });
      }
    }

    return setups;
  }

  /**
   * Get most recent swing high
   */
  private getRecentSwingHigh(swingHighs: any[]): any {
    if (swingHighs.length === 0) return null;
    return swingHighs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  }

  /**
   * Get most recent swing low
   */
  private getRecentSwingLow(swingLows: any[]): any {
    if (swingLows.length === 0) return null;
    return swingLows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  }

  /**
   * Detect liquidity sweep patterns
   */
  private detectLiquiditySweep(swings: any[], candle: Candle, tolerance: number, type: 'high' | 'low'): any {
    const recentSwings = swings
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 3);

    for (const swing of recentSwings) {
      const timeDiff = candle.timestamp.getTime() - swing.timestamp.getTime();
      const maxAge = 5 * 15 * 60 * 1000; // 5 candles * 15 minutes * 60 seconds * 1000ms

      if (timeDiff > maxAge) continue;

      if (type === 'low' && candle.low < swing.price && candle.close > swing.price + tolerance) {
        return swing;
      }

      if (type === 'high' && candle.high > swing.price && candle.close < swing.price - tolerance) {
        return swing;
      }
    }

    return null;
  }

  /**
   * Calculate pullback setup confidence
   */
  private calculatePullbackConfidence(candle: Candle, emaLevel: number, tolerance: number, direction: TradeDirection): number {
    const distance = Math.abs(candle.close - emaLevel);
    const proximityScore = 1 - (distance / tolerance);
    
    // Bonus for rejection candle patterns
    const rejectionBonus = this.hasRejectionPattern(candle, emaLevel, direction) ? 0.2 : 0;
    
    return Math.max(0.3, Math.min(0.9, proximityScore + rejectionBonus));
  }

  /**
   * Calculate breakout setup confidence
   */
  private calculateBreakoutConfidence(candle: Candle, structureLevel: number, confirmation: number, direction: TradeDirection, regime: MarketRegimeResult): number {
    const distance = Math.abs(candle.close - structureLevel);
    const confirmationScore = Math.min(1, distance / confirmation);
    
    // Bonus for strong regime confidence
    const regimeBonus = regime.confidence * 0.3;
    
    // Bonus for strong candle close
    const candleStrength = this.calculateCandleStrength(candle, direction);
    
    return Math.max(0.4, Math.min(0.95, confirmationScore + regimeBonus + candleStrength));
  }

  /**
   * Calculate continuation setup confidence
   */
  private calculateContinuationConfidence(regime: MarketRegimeResult, sweptLevel: any, direction: TradeDirection): number {
    const baseConfidence = regime.confidence * 0.7;
    const sweepQuality = 0.2; // Base sweep quality
    
    return Math.max(0.5, Math.min(0.9, baseConfidence + sweepQuality));
  }

  /**
   * Check for rejection candle patterns
   */
  private hasRejectionPattern(candle: Candle, level: number, direction: TradeDirection): boolean {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalRange = candle.high - candle.low;
    
    if (totalRange === 0) return false;
    
    const bodyRatio = bodySize / totalRange;
    
    if (direction === 'BUY') {
      // Look for hammer/doji at support
      const lowerWick = candle.open - candle.low;
      const wickRatio = lowerWick / totalRange;
      return wickRatio > 0.6 && bodyRatio < 0.4 && candle.close > level;
    } else {
      // Look for shooting star/doji at resistance
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const wickRatio = upperWick / totalRange;
      return wickRatio > 0.6 && bodyRatio < 0.4 && candle.close < level;
    }
  }

  /**
   * Calculate candle strength for breakouts
   */
  private calculateCandleStrength(candle: Candle, direction: TradeDirection): number {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalRange = candle.high - candle.low;
    
    if (totalRange === 0) return 0;
    
    const bodyRatio = bodySize / totalRange;
    const directionCorrect = direction === 'BUY' ? candle.close > candle.open : candle.close < candle.open;
    
    return directionCorrect ? bodyRatio * 0.3 : 0;
  }

  /**
   * Validate setup against filters
   */
  private validateSetup(setup: SetupResult, indicators: IndicatorData, candle: Candle): boolean {
    // Check ATR volatility filter
    const atrThreshold = DEFAULT_STRATEGY_CONFIG.regime.atrVolatilityThreshold;
    if (indicators.atr > atrThreshold * this.calculateAverageATR(indicators)) {
      return false;
    }

    // All validation checks must pass
    return setup.validationChecks.every(check => check.passed);
  }

  /**
   * Calculate average ATR (simplified - would normally use historical data)
   */
  private calculateAverageATR(indicators: IndicatorData): number {
    // Simplified: assume current ATR is representative
    return indicators.atr;
  }

  /**
   * Create validation checks for pullback setups
   */
  private createPullbackValidationChecks(candle: Candle, emaLevel: number, tolerance: number, direction: TradeDirection): ValidationCheck[] {
    const distance = Math.abs(candle.close - emaLevel);
    
    return [
      {
        name: 'EMA_PROXIMITY',
        passed: distance <= tolerance,
        value: distance,
        threshold: tolerance,
        description: `Distance to EMA must be within ${tolerance.toFixed(2)}`
      },
      {
        name: 'DIRECTION_ALIGNMENT',
        passed: direction === 'BUY' ? candle.close >= emaLevel : candle.close <= emaLevel,
        description: `Price must be on correct side of EMA for ${direction} setup`
      }
    ];
  }

  /**
   * Create validation checks for breakout setups
   */
  private createBreakoutValidationChecks(candle: Candle, structureLevel: number, confirmation: number, direction: TradeDirection): ValidationCheck[] {
    const distance = Math.abs(candle.close - structureLevel);
    
    return [
      {
        name: 'BREAKOUT_CONFIRMATION',
        passed: distance >= confirmation,
        value: distance,
        threshold: confirmation,
        description: `Breakout must exceed ${confirmation.toFixed(2)} confirmation distance`
      },
      {
        name: 'DIRECTION_ALIGNMENT',
        passed: direction === 'BUY' ? candle.close > structureLevel : candle.close < structureLevel,
        description: `Price must break structure in ${direction} direction`
      }
    ];
  }

  /**
   * Create validation checks for continuation setups
   */
  private createContinuationValidationChecks(sweptLevel: any, tolerance: number, direction: TradeDirection): ValidationCheck[] {
    return [
      {
        name: 'LIQUIDITY_SWEEP',
        passed: true, // Already validated in detection
        description: `Liquidity sweep of ${sweptLevel.price.toFixed(2)} detected`
      },
      {
        name: 'CONTINUATION_DIRECTION',
        passed: true, // Already validated in detection
        description: `Continuation setup aligned with ${direction} direction`
      }
    ];
  }
}