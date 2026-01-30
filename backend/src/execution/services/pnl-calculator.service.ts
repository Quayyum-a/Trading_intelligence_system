/**
 * PnL Calculator Service - Calculates profit and loss for positions and trades
 */

import { Position, ExecutionTrade, OrderSide } from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface PnLCalculationResult {
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  breakEvenPrice: number;
  riskRewardRatio: number;
  marginLevel: number;
}

export interface RealizedPnLResult {
  realizedPnL: number;
  realizedPnLPercent: number;
  holdingPeriod: number; // in hours
  riskRewardAchieved: number;
  wasWinningTrade: boolean;
}

export interface PortfolioPnLSummary {
  totalUnrealizedPnL: number;
  totalRealizedPnL: number;
  totalMarginUsed: number;
  portfolioValue: number;
  marginLevel: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
}

export class PnLCalculatorService {
  /**
   * Calculate unrealized PnL for an open position
   */
  calculateUnrealizedPnL(
    position: Position,
    currentPrice: number,
    accountBalance: number
  ): PnLCalculationResult {
    try {
      // Calculate price difference based on position side
      const priceDifference = position.side === 'BUY'
        ? currentPrice - position.avgEntryPrice
        : position.avgEntryPrice - currentPrice;

      // Calculate unrealized PnL
      const unrealizedPnL = priceDifference * position.size;

      // Calculate unrealized PnL percentage
      const positionValue = position.avgEntryPrice * position.size;
      const unrealizedPnLPercent = positionValue > 0 ? (unrealizedPnL / positionValue) * 100 : 0;

      // Calculate break-even price (entry price)
      const breakEvenPrice = position.avgEntryPrice;

      // Calculate current risk-reward ratio
      const riskDistance = Math.abs(position.avgEntryPrice - position.stopLoss);
      const currentRewardDistance = Math.abs(currentPrice - position.avgEntryPrice);
      const riskRewardRatio = riskDistance > 0 ? currentRewardDistance / riskDistance : 0;

      // Calculate margin level
      const equity = accountBalance + unrealizedPnL;
      const marginLevel = position.marginUsed > 0 ? (equity / position.marginUsed) * 100 : 0;

      const result: PnLCalculationResult = {
        unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
        unrealizedPnLPercent: Math.round(unrealizedPnLPercent * 100) / 100,
        breakEvenPrice: Math.round(breakEvenPrice * 100000) / 100000,
        riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
        marginLevel: Math.round(marginLevel * 100) / 100
      };

      logger.debug('Unrealized PnL calculated', {
        positionId: position.id,
        currentPrice,
        entryPrice: position.avgEntryPrice,
        side: position.side,
        size: position.size,
        result
      });

      return result;

    } catch (error) {
      logger.error('Failed to calculate unrealized PnL', {
        positionId: position.id,
        currentPrice,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate realized PnL for a closed position
   */
  calculateRealizedPnL(
    position: Position,
    closePrice: number,
    openTime: Date,
    closeTime: Date
  ): RealizedPnLResult {
    try {
      // Calculate price difference based on position side
      const priceDifference = position.side === 'BUY'
        ? closePrice - position.avgEntryPrice
        : position.avgEntryPrice - closePrice;

      // Calculate realized PnL
      const realizedPnL = priceDifference * position.size;

      // Calculate realized PnL percentage
      const positionValue = position.avgEntryPrice * position.size;
      const realizedPnLPercent = positionValue > 0 ? (realizedPnL / positionValue) * 100 : 0;

      // Calculate holding period in hours
      const holdingPeriod = (closeTime.getTime() - openTime.getTime()) / (1000 * 60 * 60);

      // Calculate achieved risk-reward ratio
      const riskDistance = Math.abs(position.avgEntryPrice - position.stopLoss);
      const actualRewardDistance = Math.abs(closePrice - position.avgEntryPrice);
      const riskRewardAchieved = riskDistance > 0 ? actualRewardDistance / riskDistance : 0;

      // Determine if it was a winning trade
      const wasWinningTrade = realizedPnL > 0;

      const result: RealizedPnLResult = {
        realizedPnL: Math.round(realizedPnL * 100) / 100,
        realizedPnLPercent: Math.round(realizedPnLPercent * 100) / 100,
        holdingPeriod: Math.round(holdingPeriod * 100) / 100,
        riskRewardAchieved: Math.round(riskRewardAchieved * 100) / 100,
        wasWinningTrade
      };

      logger.info('Realized PnL calculated', {
        positionId: position.id,
        entryPrice: position.avgEntryPrice,
        closePrice,
        side: position.side,
        size: position.size,
        result
      });

      return result;

    } catch (error) {
      logger.error('Failed to calculate realized PnL', {
        positionId: position.id,
        closePrice,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate portfolio-level PnL summary
   */
  calculatePortfolioPnL(
    openPositions: Position[],
    closedTrades: RealizedPnLResult[],
    currentPrices: Record<string, number>,
    accountBalance: number
  ): PortfolioPnLSummary {
    try {
      // Calculate total unrealized PnL from open positions
      let totalUnrealizedPnL = 0;
      let totalMarginUsed = 0;

      for (const position of openPositions) {
        const symbol = this.getSymbolFromPosition(position);
        const currentPrice = currentPrices[symbol] || position.avgEntryPrice;
        
        const pnlResult = this.calculateUnrealizedPnL(position, currentPrice, accountBalance);
        totalUnrealizedPnL += pnlResult.unrealizedPnL;
        totalMarginUsed += position.marginUsed;
      }

      // Calculate total realized PnL from closed trades
      const totalRealizedPnL = closedTrades.reduce((sum, trade) => sum + trade.realizedPnL, 0);

      // Calculate portfolio value
      const portfolioValue = accountBalance + totalUnrealizedPnL + totalRealizedPnL;

      // Calculate margin level
      const marginLevel = totalMarginUsed > 0 ? (portfolioValue / totalMarginUsed) * 100 : 0;

      // Calculate trading statistics
      const winningTrades = closedTrades.filter(trade => trade.wasWinningTrade);
      const losingTrades = closedTrades.filter(trade => !trade.wasWinningTrade);

      const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
      
      const averageWin = winningTrades.length > 0 
        ? winningTrades.reduce((sum, trade) => sum + trade.realizedPnL, 0) / winningTrades.length 
        : 0;
      
      const averageLoss = losingTrades.length > 0 
        ? Math.abs(losingTrades.reduce((sum, trade) => sum + trade.realizedPnL, 0) / losingTrades.length)
        : 0;

      const profitFactor = averageLoss > 0 ? averageWin / averageLoss : 0;

      const summary: PortfolioPnLSummary = {
        totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
        totalRealizedPnL: Math.round(totalRealizedPnL * 100) / 100,
        totalMarginUsed: Math.round(totalMarginUsed * 100) / 100,
        portfolioValue: Math.round(portfolioValue * 100) / 100,
        marginLevel: Math.round(marginLevel * 100) / 100,
        winRate: Math.round(winRate * 100) / 100,
        averageWin: Math.round(averageWin * 100) / 100,
        averageLoss: Math.round(averageLoss * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100
      };

      logger.info('Portfolio PnL calculated', {
        openPositions: openPositions.length,
        closedTrades: closedTrades.length,
        summary
      });

      return summary;

    } catch (error) {
      logger.error('Failed to calculate portfolio PnL', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate maximum drawdown for a series of trades
   */
  calculateMaxDrawdown(tradeResults: RealizedPnLResult[]): {
    maxDrawdown: number;
    maxDrawdownPercent: number;
    drawdownPeriod: number;
  } {
    if (tradeResults.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0, drawdownPeriod: 0 };
    }

    let runningBalance = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let drawdownStart = 0;
    let maxDrawdownPeriod = 0;

    for (let i = 0; i < tradeResults.length; i++) {
      runningBalance += tradeResults[i].realizedPnL;
      
      if (runningBalance > peak) {
        peak = runningBalance;
        drawdownStart = i;
      }
      
      const currentDrawdown = peak - runningBalance;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
        maxDrawdownPercent = peak > 0 ? (currentDrawdown / peak) * 100 : 0;
        maxDrawdownPeriod = i - drawdownStart;
      }
    }

    return {
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
      drawdownPeriod: maxDrawdownPeriod
    };
  }

  /**
   * Calculate Sharpe ratio for trading performance
   */
  calculateSharpeRatio(tradeResults: RealizedPnLResult[], riskFreeRate: number = 0.02): number {
    if (tradeResults.length === 0) {
      return 0;
    }

    const returns = tradeResults.map(trade => trade.realizedPnLPercent / 100);
    const averageReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    
    // Calculate standard deviation
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - averageReturn, 2), 0) / returns.length;
    const standardDeviation = Math.sqrt(variance);

    if (standardDeviation === 0) {
      return 0;
    }

    // Annualized Sharpe ratio (assuming daily returns)
    const excessReturn = averageReturn - (riskFreeRate / 365);
    const sharpeRatio = (excessReturn * Math.sqrt(365)) / standardDeviation;

    return Math.round(sharpeRatio * 100) / 100;
  }

  /**
   * Calculate position size based on risk management
   */
  calculateOptimalPositionSize(
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number,
    leverage: number
  ): {
    positionSize: number;
    marginRequired: number;
    riskAmount: number;
  } {
    // Calculate risk amount
    const riskAmount = accountBalance * riskPercent;
    
    // Calculate stop loss distance
    const stopLossDistance = Math.abs(entryPrice - stopLoss);
    
    // Calculate position size based on risk
    const positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;
    
    // Calculate margin required
    const marginRequired = (positionSize * entryPrice) / leverage;

    return {
      positionSize: Math.round(positionSize * 100) / 100,
      marginRequired: Math.round(marginRequired * 100) / 100,
      riskAmount: Math.round(riskAmount * 100) / 100
    };
  }

  /**
   * Validate PnL calculation inputs
   */
  validatePnLInputs(position: Position, price: number): void {
    if (!position) {
      throw new Error('Position is required for PnL calculation');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    if (position.size <= 0) {
      throw new Error('Position size must be positive');
    }

    if (position.avgEntryPrice <= 0) {
      throw new Error('Entry price must be positive');
    }
  }

  /**
   * Get symbol from position (helper method)
   */
  private getSymbolFromPosition(position: Position): string {
    // In a real implementation, this would extract the symbol from the position
    // For now, we'll return a default symbol
    return 'XAUUSD';
  }

  /**
   * Calculate risk-reward ratio for a trade setup
   */
  calculateRiskRewardRatio(entryPrice: number, stopLoss: number, takeProfit: number): number {
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    
    return riskDistance > 0 ? rewardDistance / riskDistance : 0;
  }

  /**
   * Calculate break-even price including spread and commission
   */
  calculateBreakEvenPrice(
    entryPrice: number,
    side: OrderSide,
    spread: number = 0,
    commission: number = 0,
    positionSize: number = 1
  ): number {
    const totalCost = commission * 2; // Round trip commission
    const costPerUnit = totalCost / positionSize;
    
    if (side === 'BUY') {
      return entryPrice + spread + costPerUnit;
    } else {
      return entryPrice - spread - costPerUnit;
    }
  }
}