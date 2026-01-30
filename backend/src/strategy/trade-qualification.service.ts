import type { Candle } from '../types/database.js';
import type {
  IndicatorData,
  SetupResult,
  TradeQualificationService,
  QualificationResult,
  StructureAnalysis
} from './strategy.types.js';
import type { SwingPoint } from '../indicators/indicator.interface.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class TradeQualificationServiceImpl implements TradeQualificationService {
  
  /**
   * Qualify trade setup with complete parameters
   */
  qualifyTrade(setup: SetupResult, indicators: IndicatorData, candle: Candle): QualificationResult {
    try {
      // Analyze structure for stop loss placement
      const structureAnalysis = this.analyzeStructure(setup, indicators, candle);
      
      // Calculate stop loss
      const stopLoss = this.calculateStopLoss(setup, structureAnalysis, indicators.atr);
      
      if (!stopLoss) {
        return {
          qualified: false,
          entryPrice: setup.entryPrice,
          reasoning: 'Unable to determine valid stop loss level',
          structureAnalysis
        };
      }

      // Calculate stop distance
      const stopDistance = Math.abs(setup.entryPrice - stopLoss);
      
      // Calculate take profit using RR ratio
      const takeProfit = this.calculateTakeProfit(setup, stopLoss, stopDistance);
      
      // Calculate reward-to-risk ratio
      const rrRatio = Math.abs(takeProfit - setup.entryPrice) / stopDistance;
      
      // Validate minimum RR ratio
      if (rrRatio < DEFAULT_STRATEGY_CONFIG.risk.minRRRatio) {
        return {
          qualified: false,
          entryPrice: setup.entryPrice,
          stopLoss,
          stopDistance,
          rrRatio,
          reasoning: `RR ratio ${rrRatio.toFixed(2)} below minimum ${DEFAULT_STRATEGY_CONFIG.risk.minRRRatio}`,
          structureAnalysis
        };
      }

      return {
        qualified: true,
        entryPrice: setup.entryPrice,
        stopLoss,
        takeProfit,
        stopDistance,
        rrRatio,
        reasoning: `Qualified trade: Entry ${setup.entryPrice.toFixed(2)}, SL ${stopLoss.toFixed(2)}, TP ${takeProfit.toFixed(2)}, RR ${rrRatio.toFixed(2)}`,
        structureAnalysis
      };

    } catch (error) {
      return {
        qualified: false,
        entryPrice: setup.entryPrice,
        reasoning: `Qualification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        structureAnalysis: this.createEmptyStructureAnalysis()
      };
    }
  }

  /**
   * Analyze market structure for stop loss placement
   */
  private analyzeStructure(setup: SetupResult, indicators: IndicatorData, candle: Candle): StructureAnalysis {
    const relevantSwing = this.findRelevantSwing(setup, indicators);
    const atrBuffer = this.calculateATRBuffer(indicators.atr, setup.type);
    
    if (!relevantSwing) {
      return this.createEmptyStructureAnalysis();
    }

    const stopDistance = this.calculateStopDistanceFromSwing(setup, relevantSwing, atrBuffer);
    const stopBeyondStructure = this.validateStopBeyondStructure(setup, relevantSwing, atrBuffer);
    const invalidationLevel = this.calculateInvalidationLevel(relevantSwing, atrBuffer, setup.direction);

    return {
      relevantSwing,
      atrBuffer,
      stopBeyondStructure,
      stopDistance,
      invalidationLevel
    };
  }

  /**
   * Find the most relevant swing point for stop loss placement
   */
  private findRelevantSwing(setup: SetupResult, indicators: IndicatorData): SwingPoint | null {
    const { swingHighs, swingLows } = indicators;
    
    // For BUY setups, look for recent swing low
    if (setup.direction === 'BUY') {
      return this.findRecentSwingLow(swingLows, setup.entryPrice);
    }
    
    // For SELL setups, look for recent swing high
    if (setup.direction === 'SELL') {
      return this.findRecentSwingHigh(swingHighs, setup.entryPrice);
    }

    return null;
  }

  /**
   * Find recent swing low below entry price
   */
  private findRecentSwingLow(swingLows: SwingPoint[], entryPrice: number): SwingPoint | null {
    const relevantLows = swingLows
      .filter(swing => swing.price < entryPrice * 0.999) // Below entry with small buffer
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Most recent first

    return relevantLows.length > 0 ? relevantLows[0] : null;
  }

  /**
   * Find recent swing high above entry price
   */
  private findRecentSwingHigh(swingHighs: SwingPoint[], entryPrice: number): SwingPoint | null {
    const relevantHighs = swingHighs
      .filter(swing => swing.price > entryPrice * 1.001) // Above entry with small buffer
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Most recent first

    return relevantHighs.length > 0 ? relevantHighs[0] : null;
  }

  /**
   * Calculate ATR buffer based on setup type
   */
  private calculateATRBuffer(atr: number, setupType: string): number {
    const multipliers = {
      'PULLBACK_TO_EMA20': 0.5,
      'PULLBACK_TO_EMA50': 0.6,
      'STRUCTURE_BREAKOUT': 0.3,
      'CONTINUATION_AFTER_SWEEP': 0.4
    };

    const multiplier = multipliers[setupType as keyof typeof multipliers] || 0.5;
    return atr * multiplier;
  }

  /**
   * Calculate stop distance from swing level
   */
  private calculateStopDistanceFromSwing(setup: SetupResult, swing: SwingPoint, atrBuffer: number): number {
    if (setup.direction === 'BUY') {
      const stopLevel = swing.price - atrBuffer;
      return Math.abs(setup.entryPrice - stopLevel);
    } else {
      const stopLevel = swing.price + atrBuffer;
      return Math.abs(setup.entryPrice - stopLevel);
    }
  }

  /**
   * Validate that stop is positioned beyond structure
   */
  private validateStopBeyondStructure(setup: SetupResult, swing: SwingPoint, atrBuffer: number): boolean {
    if (setup.direction === 'BUY') {
      const stopLevel = swing.price - atrBuffer;
      return stopLevel < swing.price;
    } else {
      const stopLevel = swing.price + atrBuffer;
      return stopLevel > swing.price;
    }
  }

  /**
   * Calculate invalidation level
   */
  private calculateInvalidationLevel(swing: SwingPoint, atrBuffer: number, direction: string): number {
    if (direction === 'BUY') {
      return swing.price - atrBuffer;
    } else {
      return swing.price + atrBuffer;
    }
  }

  /**
   * Calculate stop loss level
   */
  private calculateStopLoss(setup: SetupResult, structureAnalysis: StructureAnalysis, atr: number): number | null {
    if (!structureAnalysis.relevantSwing) {
      // Fallback: use ATR-based stop
      return this.calculateATRBasedStop(setup, atr);
    }

    return structureAnalysis.invalidationLevel;
  }

  /**
   * Calculate ATR-based stop loss as fallback
   */
  private calculateATRBasedStop(setup: SetupResult, atr: number): number {
    const stopDistance = atr * 1.5; // 1.5 ATR stop
    
    if (setup.direction === 'BUY') {
      return setup.entryPrice - stopDistance;
    } else {
      return setup.entryPrice + stopDistance;
    }
  }

  /**
   * Calculate take profit using reward-to-risk ratio
   */
  private calculateTakeProfit(setup: SetupResult, stopLoss: number, stopDistance: number): number {
    const rrRatio = DEFAULT_STRATEGY_CONFIG.risk.minRRRatio;
    const rewardDistance = stopDistance * rrRatio;
    
    if (setup.direction === 'BUY') {
      return setup.entryPrice + rewardDistance;
    } else {
      return setup.entryPrice - rewardDistance;
    }
  }

  /**
   * Create empty structure analysis for error cases
   */
  private createEmptyStructureAnalysis(): StructureAnalysis {
    return {
      relevantSwing: {
        pair: '',
        timeframe: '',
        timestamp: new Date(),
        type: 'high',
        price: 0,
        lookback_periods: 0
      },
      atrBuffer: 0,
      stopBeyondStructure: false,
      stopDistance: 0,
      invalidationLevel: 0
    };
  }

  /**
   * Validate trade qualification parameters
   */
  private validateQualification(qualification: QualificationResult): boolean {
    // Check required parameters are present
    if (!qualification.qualified) {
      return false;
    }

    if (!qualification.stopLoss || !qualification.takeProfit || !qualification.rrRatio) {
      return false;
    }

    // Check stop distance is reasonable
    if (qualification.stopDistance && qualification.stopDistance <= 0) {
      return false;
    }

    // Check RR ratio meets minimum
    if (qualification.rrRatio < DEFAULT_STRATEGY_CONFIG.risk.minRRRatio) {
      return false;
    }

    return true;
  }

  /**
   * Calculate position size based on risk and stop distance
   */
  calculatePositionSize(qualification: QualificationResult, accountBalance: number, riskPercent: number): number {
    if (!qualification.qualified || !qualification.stopDistance) {
      return 0;
    }

    const riskAmount = accountBalance * riskPercent;
    const positionSize = riskAmount / qualification.stopDistance;
    
    return Math.max(0, positionSize);
  }

  /**
   * Validate stop loss placement rules
   */
  private validateStopLossPlacement(setup: SetupResult, stopLoss: number, structureAnalysis: StructureAnalysis): boolean {
    // Stop must be beyond structure
    if (!structureAnalysis.stopBeyondStructure) {
      return false;
    }

    // Stop distance must be reasonable (not too tight or too wide)
    const stopDistance = Math.abs(setup.entryPrice - stopLoss);
    const maxStopDistance = setup.entryPrice * 0.02; // 2% max stop
    const minStopDistance = setup.entryPrice * 0.001; // 0.1% min stop

    if (stopDistance > maxStopDistance || stopDistance < minStopDistance) {
      return false;
    }

    return true;
  }

  /**
   * Calculate dynamic RR ratio based on market conditions
   */
  private calculateDynamicRRRatio(setup: SetupResult, structureAnalysis: StructureAnalysis): number {
    let baseRR = DEFAULT_STRATEGY_CONFIG.risk.minRRRatio;

    // Increase RR for high-confidence setups
    if (setup.confidence > 0.8) {
      baseRR += 0.5;
    }

    // Increase RR for strong structure
    if (structureAnalysis.stopBeyondStructure && structureAnalysis.relevantSwing) {
      baseRR += 0.3;
    }

    return Math.min(baseRR, 4.0); // Cap at 4:1 RR
  }
}