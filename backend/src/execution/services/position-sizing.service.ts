/**
 * Position Sizing Service - Calculates position sizes based on risk parameters
 */

import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface PositionSizingParams {
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  leverage: number;
  symbol: string;
}

export interface PositionSizingResult {
  positionSize: number;
  marginRequired: number;
  riskAmount: number;
  stopLossDistance: number;
  isValid: boolean;
  errors: string[];
}

export class PositionSizingService {
  private readonly MAX_RISK_PERCENT = 0.01; // 1%
  private readonly MAX_LEVERAGE = 200;
  private readonly MIN_POSITION_SIZE = 0.01;

  /**
   * Calculate position size based on risk percentage and stop loss distance
   */
  calculatePositionSize(params: PositionSizingParams): PositionSizingResult {
    const errors: string[] = [];
    
    try {
      // Validate input parameters
      if (!this.validateParameters(params, errors)) {
        return {
          positionSize: 0,
          marginRequired: 0,
          riskAmount: 0,
          stopLossDistance: 0,
          isValid: false,
          errors
        };
      }

      // Calculate stop loss distance
      const stopLossDistance = Math.abs(params.entryPrice - params.stopLoss);
      
      // Calculate risk amount
      const riskAmount = params.accountBalance * params.riskPercent;
      
      // Calculate position size based on risk
      // Position Size = Risk Amount / Stop Loss Distance
      let positionSize = riskAmount / stopLossDistance;
      
      // Ensure minimum position size
      if (positionSize < this.MIN_POSITION_SIZE) {
        positionSize = this.MIN_POSITION_SIZE;
        logger.warn('Position size adjusted to minimum', {
          calculated: riskAmount / stopLossDistance,
          adjusted: positionSize,
          symbol: params.symbol
        });
      }

      // Calculate margin required
      const marginRequired = this.calculateMarginRequired(
        positionSize, 
        params.entryPrice, 
        params.leverage
      );

      // Validate margin requirement doesn't exceed account balance
      const maxMargin = params.accountBalance * 0.8; // Use max 80% of account
      if (marginRequired > maxMargin) {
        // Adjust position size to fit margin requirement
        positionSize = (maxMargin * params.leverage) / params.entryPrice;
        
        errors.push(`Position size adjusted due to margin constraints. Required: ${marginRequired.toFixed(2)}, Available: ${maxMargin.toFixed(2)}`);
        
        logger.warn('Position size adjusted for margin requirement', {
          originalSize: riskAmount / stopLossDistance,
          adjustedSize: positionSize,
          marginRequired: this.calculateMarginRequired(positionSize, params.entryPrice, params.leverage),
          maxMargin,
          symbol: params.symbol
        });
      }

      // Final validation
      const finalMarginRequired = this.calculateMarginRequired(
        positionSize, 
        params.entryPrice, 
        params.leverage
      );

      const isValid = errors.length === 0 && 
                     finalMarginRequired <= params.accountBalance * 0.8 &&
                     positionSize >= this.MIN_POSITION_SIZE;

      return {
        positionSize: Math.round(positionSize * 100) / 100, // Round to 2 decimal places
        marginRequired: Math.round(finalMarginRequired * 100) / 100,
        riskAmount: Math.round(riskAmount * 100) / 100,
        stopLossDistance: Math.round(stopLossDistance * 100000) / 100000, // Round to 5 decimal places for forex
        isValid,
        errors
      };

    } catch (error) {
      logger.error('Error calculating position size', { params, error });
      errors.push(`Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        positionSize: 0,
        marginRequired: 0,
        riskAmount: 0,
        stopLossDistance: 0,
        isValid: false,
        errors
      };
    }
  }

  /**
   * Calculate margin required for a position
   */
  private calculateMarginRequired(positionSize: number, entryPrice: number, leverage: number): number {
    return (positionSize * entryPrice) / leverage;
  }

  /**
   * Validate position sizing parameters
   */
  private validateParameters(params: PositionSizingParams, errors: string[]): boolean {
    let isValid = true;

    // Validate account balance
    if (params.accountBalance <= 0) {
      errors.push('Account balance must be positive');
      isValid = false;
    }

    // Validate risk percentage
    if (params.riskPercent <= 0 || params.riskPercent > this.MAX_RISK_PERCENT) {
      errors.push(`Risk percentage must be between 0 and ${this.MAX_RISK_PERCENT * 100}%`);
      isValid = false;
    }

    // Validate entry price
    if (params.entryPrice <= 0) {
      errors.push('Entry price must be positive');
      isValid = false;
    }

    // Validate stop loss
    if (params.stopLoss <= 0) {
      errors.push('Stop loss must be positive');
      isValid = false;
    }

    // Validate stop loss is different from entry price
    if (Math.abs(params.entryPrice - params.stopLoss) < 0.00001) {
      errors.push('Stop loss must be different from entry price');
      isValid = false;
    }

    // Validate leverage
    if (params.leverage <= 0 || params.leverage > this.MAX_LEVERAGE) {
      errors.push(`Leverage must be between 1 and ${this.MAX_LEVERAGE}`);
      isValid = false;
    }

    // Validate symbol
    if (!params.symbol || params.symbol.trim().length === 0) {
      errors.push('Symbol is required');
      isValid = false;
    }

    return isValid;
  }

  /**
   * Calculate maximum position size based on available margin
   */
  calculateMaxPositionSize(accountBalance: number, entryPrice: number, leverage: number): number {
    const maxMargin = accountBalance * 0.8; // Use max 80% of account
    return (maxMargin * leverage) / entryPrice;
  }

  /**
   * Calculate risk-reward ratio for a trade
   */
  calculateRiskRewardRatio(entryPrice: number, stopLoss: number, takeProfit: number): number {
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    
    if (riskDistance === 0) {
      return 0;
    }
    
    return rewardDistance / riskDistance;
  }

  /**
   * Validate account balance requirements
   */
  validateAccountBalance(accountBalance: number, requiredMargin: number): boolean {
    const maxUsableBalance = accountBalance * 0.8;
    return requiredMargin <= maxUsableBalance;
  }
}