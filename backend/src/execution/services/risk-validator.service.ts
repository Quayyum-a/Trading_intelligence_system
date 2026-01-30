/**
 * Risk Validator Service - Enforces risk limits and validates trade parameters
 */

import { RiskValidator } from '../interfaces/risk-validator.interface';
import { 
  ExecutionTrade, 
  RiskValidationResult, 
  RiskViolation, 
  RiskViolationType, 
  TradeSignal 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export class RiskValidatorService implements RiskValidator {
  private readonly MAX_RISK_PERCENT = 0.01; // 1%
  private readonly MAX_LEVERAGE = 200;
  private readonly MIN_MARGIN_LEVEL = 100; // 100% margin level

  /**
   * Validate a trade signal against risk limits
   */
  async validateTrade(signal: TradeSignal, accountBalance: number): Promise<RiskValidationResult> {
    const violations: RiskViolation[] = [];

    // Check risk percentage limit
    if (signal.riskPercent > this.MAX_RISK_PERCENT) {
      violations.push({
        type: 'RISK_EXCEEDED',
        current: signal.riskPercent,
        limit: this.MAX_RISK_PERCENT,
        description: `Risk percentage ${(signal.riskPercent * 100).toFixed(2)}% exceeds maximum allowed ${(this.MAX_RISK_PERCENT * 100).toFixed(2)}%`
      });
    }

    // Check leverage limit
    if (signal.leverage > this.MAX_LEVERAGE) {
      violations.push({
        type: 'LEVERAGE_EXCEEDED',
        current: signal.leverage,
        limit: this.MAX_LEVERAGE,
        description: `Leverage ${signal.leverage}:1 exceeds maximum allowed ${this.MAX_LEVERAGE}:1`
      });
    }

    // Check margin requirement
    const marginRequired = this.calculateMarginRequired(signal);
    if (marginRequired > accountBalance * 0.8) { // Don't use more than 80% of account balance
      violations.push({
        type: 'INSUFFICIENT_MARGIN',
        current: marginRequired,
        limit: accountBalance * 0.8,
        description: `Required margin ${marginRequired.toFixed(2)} exceeds 80% of account balance ${(accountBalance * 0.8).toFixed(2)}`
      });
    }

    // Calculate adjusted position size if risk is exceeded but leverage is ok
    let adjustedPositionSize: number | undefined;
    if (violations.some(v => v.type === 'RISK_EXCEEDED') && !violations.some(v => v.type === 'LEVERAGE_EXCEEDED')) {
      adjustedPositionSize = this.calculateAdjustedPositionSize(signal, accountBalance);
    }

    const approved = violations.length === 0;

    if (!approved) {
      logger.warn('Trade validation failed', {
        signalId: signal.id,
        violations: violations.map(v => v.description)
      });
    }

    return {
      approved,
      violations,
      adjustedPositionSize
    };
  }

  /**
   * Check if margin requirement can be met for a trade
   */
  async checkMarginRequirement(trade: ExecutionTrade): Promise<boolean> {
    try {
      const marginRequired = this.calculateTradeMarginRequired(trade);
      
      // For now, we'll assume we have access to account balance
      // In a real implementation, this would query the broker adapter
      const accountBalance = 10000; // This should come from broker adapter
      
      const canMeetMargin = marginRequired <= accountBalance * 0.8;
      
      if (!canMeetMargin) {
        logger.warn('Insufficient margin for trade', {
          tradeId: trade.id,
          marginRequired,
          availableMargin: accountBalance * 0.8
        });
      }

      return canMeetMargin;
    } catch (error) {
      logger.error('Error checking margin requirement', { tradeId: trade.id, error });
      return false;
    }
  }

  /**
   * Enforce position limits for a new trade
   */
  async enforcePositionLimits(newTrade: ExecutionTrade): Promise<boolean> {
    try {
      // Check individual trade limits
      if (newTrade.riskPercent > this.MAX_RISK_PERCENT) {
        logger.warn('Trade exceeds risk limit', {
          tradeId: newTrade.id,
          riskPercent: newTrade.riskPercent,
          maxRisk: this.MAX_RISK_PERCENT
        });
        return false;
      }

      if (newTrade.leverage > this.MAX_LEVERAGE) {
        logger.warn('Trade exceeds leverage limit', {
          tradeId: newTrade.id,
          leverage: newTrade.leverage,
          maxLeverage: this.MAX_LEVERAGE
        });
        return false;
      }

      // Additional position limits could be implemented here:
      // - Maximum number of open positions
      // - Maximum exposure per symbol
      // - Maximum total risk across all positions

      return true;
    } catch (error) {
      logger.error('Error enforcing position limits', { tradeId: newTrade.id, error });
      return false;
    }
  }

  /**
   * Calculate margin required for a trade signal
   */
  private calculateMarginRequired(signal: TradeSignal): number {
    // Margin = (Position Size * Entry Price) / Leverage
    return (signal.positionSize * signal.entryPrice) / signal.leverage;
  }

  /**
   * Calculate margin required for an execution trade
   */
  private calculateTradeMarginRequired(trade: ExecutionTrade): number {
    // Margin = (Position Size * Entry Price) / Leverage
    return (trade.positionSize * trade.entryPrice) / trade.leverage;
  }

  /**
   * Calculate adjusted position size to meet risk limits
   */
  private calculateAdjustedPositionSize(signal: TradeSignal, accountBalance: number): number {
    // Calculate maximum position size based on risk limit
    const stopLossDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const maxRiskAmount = accountBalance * this.MAX_RISK_PERCENT;
    
    // Position Size = Risk Amount / Stop Loss Distance
    const adjustedSize = maxRiskAmount / stopLossDistance;
    
    // Ensure the adjusted size doesn't exceed leverage limits
    const maxSizeByLeverage = (accountBalance * 0.8 * signal.leverage) / signal.entryPrice;
    
    return Math.min(adjustedSize, maxSizeByLeverage);
  }

  /**
   * Validate risk parameters are within limits
   */
  public static isValidRiskParameters(riskPercent: number, leverage: number): boolean {
    return riskPercent <= 0.01 && leverage <= 200;
  }
}