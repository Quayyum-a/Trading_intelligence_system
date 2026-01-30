import type {
  MarketRegimeResult,
  SetupResult,
  QualificationResult,
  RiskResult,
  RRResult,
  TimeContext,
  ConfidenceScorer,
  ConfidenceResult,
  ConfidenceComponent
} from './strategy.types.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class ConfidenceScorerImpl implements ConfidenceScorer {
  
  /**
   * Calculate overall confidence score for trade decision
   */
  calculateConfidence(
    regime: MarketRegimeResult,
    setup: SetupResult,
    qualification: QualificationResult,
    risk: RiskResult,
    rr: RRResult,
    timeContext: TimeContext
  ): ConfidenceResult {
    try {
      // Calculate individual component scores
      const components = this.calculateComponentScores(regime, setup, qualification, risk, rr, timeContext);
      
      // Calculate weighted overall score
      const overallScore = this.calculateWeightedScore(components);
      
      // Get threshold from configuration
      const threshold = DEFAULT_STRATEGY_CONFIG.confidence.minThreshold;
      
      // Determine if confidence meets threshold
      const approved = overallScore >= threshold;

      return {
        overallScore,
        components,
        threshold,
        approved
      };

    } catch (error) {
      return this.createFailedConfidence(`Confidence calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate individual component confidence scores
   */
  private calculateComponentScores(
    regime: MarketRegimeResult,
    setup: SetupResult,
    qualification: QualificationResult,
    risk: RiskResult,
    rr: RRResult,
    timeContext: TimeContext
  ): ConfidenceComponent[] {
    const weights = DEFAULT_STRATEGY_CONFIG.confidence.components;
    
    return [
      this.calculateEMAAlignmentScore(regime, weights.emaAlignment),
      this.calculateStructureQualityScore(regime, setup, weights.structureQuality),
      this.calculateATRContextScore(regime, setup, weights.atrContext),
      this.calculateTimeOfDayScore(timeContext, weights.timeOfDay),
      this.calculateRRQualityScore(qualification, rr, weights.rrQuality)
    ];
  }

  /**
   * Calculate EMA alignment confidence component
   */
  private calculateEMAAlignmentScore(regime: MarketRegimeResult, weight: number): ConfidenceComponent {
    let score = 0;
    let description = '';

    const emaAlignment = regime.emaAlignment;
    
    // Base score from EMA strength
    score = emaAlignment.strength;
    
    // Bonus for clear directional alignment
    if (emaAlignment.alignment === 'BULLISH' || emaAlignment.alignment === 'BEARISH') {
      score += 0.2;
      description = `Strong ${emaAlignment.alignment.toLowerCase()} EMA alignment`;
    } else if (emaAlignment.alignment === 'FLAT') {
      score += 0.1;
      description = 'Flat EMA alignment (ranging market)';
    } else {
      score -= 0.1;
      description = 'Mixed EMA alignment (unclear direction)';
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(1, score));
    
    return {
      name: 'EMA_ALIGNMENT',
      score,
      weight,
      contribution: score * weight,
      description: description || `EMA alignment strength: ${(score * 100).toFixed(1)}%`
    };
  }

  /**
   * Calculate structure quality confidence component
   */
  private calculateStructureQualityScore(regime: MarketRegimeResult, setup: SetupResult, weight: number): ConfidenceComponent {
    let score = 0;
    let description = '';

    // Base score from swing structure quality
    score = regime.swingStructure.quality;
    
    // Bonus for setup confidence
    const setupBonus = (setup.confidence - 0.5) * 0.4; // Scale setup confidence
    score += setupBonus;
    
    // Bonus for trend alignment
    if (regime.swingStructure.trend !== 'SIDEWAYS') {
      score += 0.15;
      description = `Clear ${regime.swingStructure.trend.toLowerCase()} structure`;
    } else {
      description = 'Sideways structure pattern';
    }

    // Bonus for high-confidence setups
    if (setup.confidence > 0.8) {
      score += 0.1;
      description += ` with high setup confidence`;
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(1, score));
    
    return {
      name: 'STRUCTURE_QUALITY',
      score,
      weight,
      contribution: score * weight,
      description: description || `Structure quality: ${(score * 100).toFixed(1)}%`
    };
  }

  /**
   * Calculate ATR context confidence component
   */
  private calculateATRContextScore(regime: MarketRegimeResult, setup: SetupResult, weight: number): ConfidenceComponent {
    let score = 0.5; // Base score
    let description = '';

    // This would normally compare current ATR to historical average
    // For now, we'll use a simplified approach based on regime confidence
    
    // Higher regime confidence suggests normal volatility conditions
    if (regime.confidence > 0.7) {
      score = 0.8;
      description = 'Normal volatility conditions';
    } else if (regime.confidence > 0.5) {
      score = 0.6;
      description = 'Moderate volatility conditions';
    } else {
      score = 0.3;
      description = 'High volatility or unclear conditions';
    }

    // Bonus for breakout setups in volatile conditions
    if (setup.type === 'STRUCTURE_BREAKOUT' && regime.confidence < 0.6) {
      score += 0.2;
      description += ' (favorable for breakouts)';
    }

    // Penalty for pullback setups in high volatility
    if (setup.type.includes('PULLBACK') && regime.confidence < 0.5) {
      score -= 0.2;
      description += ' (challenging for pullbacks)';
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(1, score));
    
    return {
      name: 'ATR_CONTEXT',
      score,
      weight,
      contribution: score * weight,
      description
    };
  }

  /**
   * Calculate time of day confidence component
   */
  private calculateTimeOfDayScore(timeContext: TimeContext, weight: number): ConfidenceComponent {
    let score = 0;
    let description = '';

    // Use the time quality from context
    score = timeContext.timeQuality;
    
    // Calculate time-based factors
    const currentHour = timeContext.currentTime.getUTCHours();
    const currentMinute = timeContext.currentTime.getUTCMinutes();
    const timeInMinutes = currentHour * 60 + currentMinute;
    
    // Parse trading window
    const [startHour, startMinute] = timeContext.tradingWindowStart.toISOString().substr(11, 5).split(':').map(Number);
    const [endHour, endMinute] = timeContext.tradingWindowEnd.toISOString().substr(11, 5).split(':').map(Number);
    const windowStart = startHour * 60 + startMinute;
    const windowEnd = endHour * 60 + endMinute;
    
    // Calculate position within trading window
    if (timeInMinutes >= windowStart && timeInMinutes <= windowEnd) {
      const windowDuration = windowEnd - windowStart;
      const positionInWindow = (timeInMinutes - windowStart) / windowDuration;
      
      // Higher score in middle of trading window
      if (positionInWindow >= 0.25 && positionInWindow <= 0.75) {
        score = Math.max(score, 0.8);
        description = 'Optimal trading hours (middle of session)';
      } else {
        score = Math.max(score, 0.6);
        description = 'Good trading hours (within session)';
      }
    } else {
      score = 0;
      description = 'Outside trading window';
    }

    return {
      name: 'TIME_OF_DAY',
      score,
      weight,
      contribution: score * weight,
      description
    };
  }

  /**
   * Calculate RR quality confidence component
   */
  private calculateRRQualityScore(qualification: QualificationResult, rr: RRResult, weight: number): ConfidenceComponent {
    let score = 0;
    let description = '';

    if (!qualification.qualified || !rr.approved) {
      return {
        name: 'RR_QUALITY',
        score: 0,
        weight,
        contribution: 0,
        description: 'Trade not qualified or RR not approved'
      };
    }

    const rrRatio = qualification.rrRatio || 0;
    const minRR = DEFAULT_STRATEGY_CONFIG.risk.minRRRatio;
    
    // Base score from RR ratio
    if (rrRatio >= minRR) {
      score = 0.6; // Base score for meeting minimum
      
      // Bonus for higher RR ratios
      const rrBonus = Math.min(0.4, (rrRatio - minRR) * 0.2);
      score += rrBonus;
      
      description = `RR ratio ${rrRatio.toFixed(2)}:1`;
      
      // Additional bonus for excellent RR ratios
      if (rrRatio >= 3.0) {
        score = Math.min(1, score + 0.1);
        description += ' (excellent)';
      } else if (rrRatio >= 2.5) {
        description += ' (very good)';
      } else if (rrRatio >= minRR) {
        description += ' (good)';
      }
    } else {
      score = 0;
      description = `RR ratio ${rrRatio.toFixed(2)}:1 below minimum ${minRR}:1`;
    }

    // Bonus for low margin usage
    if (rr.marginPercent < 0.2) { // Less than 20% margin usage
      score += 0.1;
      description += ', low margin usage';
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(1, score));
    
    return {
      name: 'RR_QUALITY',
      score,
      weight,
      contribution: score * weight,
      description
    };
  }

  /**
   * Calculate weighted overall confidence score
   */
  private calculateWeightedScore(components: ConfidenceComponent[]): number {
    const totalContribution = components.reduce((sum, component) => sum + component.contribution, 0);
    
    // Ensure score is within bounds
    return Math.max(0, Math.min(1, totalContribution));
  }

  /**
   * Validate confidence component weights sum to 1.0
   */
  private validateWeights(weights: any): boolean {
    const totalWeight = Object.values(weights).reduce((sum: number, weight) => sum + (weight as number), 0);
    return Math.abs(totalWeight - 1.0) < 0.001;
  }

  /**
   * Create failed confidence result
   */
  private createFailedConfidence(reasoning: string): ConfidenceResult {
    return {
      overallScore: 0,
      components: [],
      threshold: DEFAULT_STRATEGY_CONFIG.confidence.minThreshold,
      approved: false
    };
  }

  /**
   * Calculate confidence score for specific setup types
   */
  calculateSetupTypeConfidence(setupType: string, regime: MarketRegimeResult): number {
    let score = 0.5; // Base score

    switch (setupType) {
      case 'PULLBACK_TO_EMA20':
        // Higher confidence in strong trends
        if (regime.confidence > 0.7) {
          score = 0.8;
        } else if (regime.confidence > 0.5) {
          score = 0.6;
        }
        break;
        
      case 'PULLBACK_TO_EMA50':
        // Requires very strong trend
        if (regime.confidence > 0.8) {
          score = 0.9;
        } else {
          score = 0.4;
        }
        break;
        
      case 'STRUCTURE_BREAKOUT':
        // Good in both trending and ranging markets
        score = 0.7;
        if (regime.regime === 'RANGING') {
          score = 0.8; // Better in ranging markets
        }
        break;
        
      case 'CONTINUATION_AFTER_SWEEP':
        // Requires strong trend
        if (regime.confidence > 0.6) {
          score = 0.8;
        } else {
          score = 0.3;
        }
        break;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Adjust confidence based on market conditions
   */
  adjustConfidenceForMarketConditions(baseConfidence: number, regime: MarketRegimeResult): number {
    let adjustedConfidence = baseConfidence;

    // Reduce confidence in NO_TRADE regimes
    if (regime.regime === 'NO_TRADE') {
      adjustedConfidence *= 0.1;
    }

    // Reduce confidence in low-quality regimes
    if (regime.confidence < 0.3) {
      adjustedConfidence *= 0.7;
    }

    // Boost confidence in high-quality regimes
    if (regime.confidence > 0.8) {
      adjustedConfidence = Math.min(1, adjustedConfidence * 1.1);
    }

    return Math.max(0, Math.min(1, adjustedConfidence));
  }
}