import type {
  IndicatorData,
  MarketRegimeService,
  MarketRegimeResult,
  EMAAlignment,
  SwingStructure,
  MarketRegime
} from './strategy.types.js';
import type { SwingPoint } from '../indicators/indicator.interface.js';

export class MarketRegimeDetectionService implements MarketRegimeService {
  
  /**
   * Detect market regime based on EMA alignment and swing structure
   */
  detectRegime(indicators: IndicatorData): MarketRegimeResult {
    const emaAlignment = this.analyzeEMAAlignment(indicators);
    const swingStructure = this.analyzeSwingStructure(indicators.swingHighs, indicators.swingLows);
    
    const regime = this.classifyRegime(emaAlignment, swingStructure, indicators.atr);
    const confidence = this.calculateRegimeConfidence(emaAlignment, swingStructure);
    const reasoning = this.generateRegimeReasoning(regime, emaAlignment, swingStructure);

    return {
      regime,
      confidence,
      emaAlignment,
      swingStructure,
      reasoning
    };
  }

  /**
   * Analyze EMA alignment and calculate strength
   */
  private analyzeEMAAlignment(indicators: IndicatorData): EMAAlignment {
    const { ema20, ema50, ema200 } = indicators;
    
    let alignment: 'BULLISH' | 'BEARISH' | 'MIXED' | 'FLAT';
    let strength: number;

    // Determine alignment type
    if (ema20 > ema50 && ema50 > ema200) {
      alignment = 'BULLISH';
      // Calculate strength based on separation
      const separation20_50 = (ema20 - ema50) / ema50;
      const separation50_200 = (ema50 - ema200) / ema200;
      strength = Math.min(1.0, (separation20_50 + separation50_200) * 100);
    } else if (ema20 < ema50 && ema50 < ema200) {
      alignment = 'BEARISH';
      // Calculate strength based on separation
      const separation20_50 = (ema50 - ema20) / ema50;
      const separation50_200 = (ema200 - ema50) / ema200;
      strength = Math.min(1.0, (separation20_50 + separation50_200) * 100);
    } else {
      // Check if EMAs are relatively flat (within 0.1% of each other)
      const maxEma = Math.max(ema20, ema50, ema200);
      const minEma = Math.min(ema20, ema50, ema200);
      const range = (maxEma - minEma) / maxEma;
      
      if (range < 0.001) {
        alignment = 'FLAT';
        strength = 1.0 - range * 1000; // Inverse of range
      } else {
        alignment = 'MIXED';
        strength = 0.3; // Low strength for mixed conditions
      }
    }

    return {
      ema20,
      ema50,
      ema200,
      alignment,
      strength: Math.max(0, Math.min(1, strength))
    };
  }

  /**
   * Analyze swing structure to determine trend quality
   */
  private analyzeSwingStructure(swingHighs: SwingPoint[], swingLows: SwingPoint[]): SwingStructure {
    // Get recent swings (last 10 of each type)
    const recentHighs = this.getRecentSwings(swingHighs, 10);
    const recentLows = this.getRecentSwings(swingLows, 10);
    
    const trend = this.determineTrend(recentHighs, recentLows);
    const quality = this.calculateStructureQuality(recentHighs, recentLows, trend);

    return {
      recentHighs,
      recentLows,
      trend,
      quality
    };
  }

  /**
   * Get most recent swing points sorted by timestamp
   */
  private getRecentSwings(swings: SwingPoint[], count: number): SwingPoint[] {
    return swings
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }

  /**
   * Determine trend based on swing progression
   */
  private determineTrend(highs: SwingPoint[], lows: SwingPoint[]): 'HIGHER_HIGHS_LOWS' | 'LOWER_HIGHS_LOWS' | 'SIDEWAYS' {
    if (highs.length < 2 || lows.length < 2) {
      return 'SIDEWAYS';
    }

    // Check for higher highs and higher lows
    const higherHighs = this.isProgressionHigher(highs);
    const higherLows = this.isProgressionHigher(lows);
    
    // Check for lower highs and lower lows
    const lowerHighs = this.isProgressionLower(highs);
    const lowerLows = this.isProgressionLower(lows);

    if (higherHighs && higherLows) {
      return 'HIGHER_HIGHS_LOWS';
    } else if (lowerHighs && lowerLows) {
      return 'LOWER_HIGHS_LOWS';
    } else {
      return 'SIDEWAYS';
    }
  }

  /**
   * Check if swing progression is generally higher
   */
  private isProgressionHigher(swings: SwingPoint[]): boolean {
    if (swings.length < 3) return false;
    
    let higherCount = 0;
    for (let i = 1; i < Math.min(swings.length, 4); i++) {
      if (swings[i - 1].price > swings[i].price) {
        higherCount++;
      }
    }
    
    return higherCount >= 2;
  }

  /**
   * Check if swing progression is generally lower
   */
  private isProgressionLower(swings: SwingPoint[]): boolean {
    if (swings.length < 3) return false;
    
    let lowerCount = 0;
    for (let i = 1; i < Math.min(swings.length, 4); i++) {
      if (swings[i - 1].price < swings[i].price) {
        lowerCount++;
      }
    }
    
    return lowerCount >= 2;
  }

  /**
   * Calculate structure quality based on consistency and clarity
   */
  private calculateStructureQuality(highs: SwingPoint[], lows: SwingPoint[], trend: string): number {
    if (highs.length < 2 || lows.length < 2) {
      return 0.1;
    }

    let quality = 0.5; // Base quality

    // Bonus for clear trend
    if (trend !== 'SIDEWAYS') {
      quality += 0.3;
    }

    // Bonus for sufficient swing points
    const totalSwings = highs.length + lows.length;
    if (totalSwings >= 8) {
      quality += 0.1;
    }

    // Penalty for overlapping ranges (ranging market)
    if (this.hasOverlappingRanges(highs, lows)) {
      quality -= 0.2;
    }

    return Math.max(0, Math.min(1, quality));
  }

  /**
   * Check if swing ranges overlap significantly (indicating ranging market)
   */
  private hasOverlappingRanges(highs: SwingPoint[], lows: SwingPoint[]): boolean {
    if (highs.length < 2 || lows.length < 2) {
      return false;
    }

    const recentHighs = highs.slice(0, 3).map(s => s.price);
    const recentLows = lows.slice(0, 3).map(s => s.price);
    
    const maxLow = Math.max(...recentLows);
    const minHigh = Math.min(...recentHighs);
    
    // If max low is close to min high, ranges overlap
    return maxLow > minHigh * 0.995;
  }

  /**
   * Classify market regime based on analysis
   */
  private classifyRegime(emaAlignment: EMAAlignment, swingStructure: SwingStructure, atr: number): MarketRegime {
    // Check for NO_TRADE conditions first
    if (this.isNoTradeCondition(emaAlignment, swingStructure, atr)) {
      return 'NO_TRADE';
    }

    // Bullish trend conditions
    if (emaAlignment.alignment === 'BULLISH' && 
        swingStructure.trend === 'HIGHER_HIGHS_LOWS' &&
        emaAlignment.strength > 0.3 &&
        swingStructure.quality > 0.4) {
      return 'BULLISH_TREND';
    }

    // Bearish trend conditions
    if (emaAlignment.alignment === 'BEARISH' && 
        swingStructure.trend === 'LOWER_HIGHS_LOWS' &&
        emaAlignment.strength > 0.3 &&
        swingStructure.quality > 0.4) {
      return 'BEARISH_TREND';
    }

    // Ranging conditions
    if (emaAlignment.alignment === 'FLAT' || 
        swingStructure.trend === 'SIDEWAYS' ||
        this.hasOverlappingRanges(swingStructure.recentHighs, swingStructure.recentLows)) {
      return 'RANGING';
    }

    // Default to NO_TRADE for unclear conditions
    return 'NO_TRADE';
  }

  /**
   * Check for NO_TRADE conditions
   */
  private isNoTradeCondition(emaAlignment: EMAAlignment, swingStructure: SwingStructure, atr: number): boolean {
    // Very low confidence in EMA alignment
    if (emaAlignment.strength < 0.2) {
      return true;
    }

    // Very poor structure quality
    if (swingStructure.quality < 0.2) {
      return true;
    }

    // Mixed EMA alignment with poor structure
    if (emaAlignment.alignment === 'MIXED' && swingStructure.quality < 0.5) {
      return true;
    }

    // Insufficient swing data
    if (swingStructure.recentHighs.length < 2 || swingStructure.recentLows.length < 2) {
      return true;
    }

    return false;
  }

  /**
   * Calculate overall regime confidence
   */
  private calculateRegimeConfidence(emaAlignment: EMAAlignment, swingStructure: SwingStructure): number {
    const emaWeight = 0.6;
    const structureWeight = 0.4;
    
    const emaConfidence = emaAlignment.strength;
    const structureConfidence = swingStructure.quality;
    
    return (emaConfidence * emaWeight) + (structureConfidence * structureWeight);
  }

  /**
   * Generate human-readable reasoning for regime classification
   */
  private generateRegimeReasoning(regime: MarketRegime, emaAlignment: EMAAlignment, swingStructure: SwingStructure): string {
    const parts: string[] = [];

    // EMA analysis
    parts.push(`EMA alignment: ${emaAlignment.alignment} (strength: ${(emaAlignment.strength * 100).toFixed(1)}%)`);
    
    // Structure analysis
    parts.push(`Swing structure: ${swingStructure.trend} (quality: ${(swingStructure.quality * 100).toFixed(1)}%)`);
    
    // Regime conclusion
    parts.push(`Classified as: ${regime}`);

    return parts.join('; ');
  }
}