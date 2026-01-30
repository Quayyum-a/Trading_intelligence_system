/**
 * PnL Calculation Service - Handles profit and loss calculations
 */

import { IPnLCalculationService } from '../interfaces/pnl-calculation.interface';
import { Position } from '../interfaces/position-state-machine.interface';
import { TradeExecution, PositionMetrics, PositionState } from '../types/position-lifecycle.types';

export class PnLCalculationService implements IPnLCalculationService {
  private readonly commissionRate: number = 0.0001; // 1 basis point default

  constructor(
    private readonly positionRepository: any, // Will be injected
    private readonly executionRepository: any, // Will be injected
    commissionRate?: number
  ) {
    if (commissionRate !== undefined) {
      this.commissionRate = commissionRate;
    }
  }

  calculateUnrealizedPnL(position: Position, currentPrice: number): number {
    if (position.size === 0) {
      return 0;
    }

    // Calculate price difference based on position side
    const priceDiff = position.side === 'BUY' 
      ? currentPrice - position.avgEntryPrice
      : position.avgEntryPrice - currentPrice;

    // Calculate gross PnL
    const grossPnL = priceDiff * position.size;

    // Subtract commission (estimated for closing the position)
    const estimatedCommission = this.calculateCommission(currentPrice, position.size);
    
    return grossPnL - estimatedCommission;
  }

  calculateRealizedPnL(execution: TradeExecution): number {
    // This method calculates PnL for a specific execution
    // For a complete calculation, we need the position's entry price
    // This is a simplified version - full implementation would need position context
    
    // For now, return 0 as this should be calculated in context of the position
    // The actual calculation happens in the execution tracking service
    return 0;
  }

  async updatePositionPnL(positionId: string, marketPrice: number): Promise<void> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Only calculate unrealized PnL for open positions
    if (position.status !== PositionState.OPEN || position.size === 0) {
      console.log(`Skipping PnL update for position ${positionId}: status=${position.status}, size=${position.size}`);
      return;
    }

    const unrealizedPnL = this.calculateUnrealizedPnL(position, marketPrice);
    console.log(`Updating PnL for position ${positionId}: ${position.unrealizedPnL} -> ${unrealizedPnL}`);

    // Update position with new unrealized PnL
    await this.positionRepository.update(positionId, {
      unrealizedPnL,
      updatedAt: new Date()
    });
    
    console.log(`✅ PnL updated successfully for position ${positionId}`);
  }

  async getPositionMetrics(positionId: string): Promise<PositionMetrics> {
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Get all executions for this position
    const executions = await this.executionRepository.findByPositionId(positionId);

    // Calculate metrics
    const totalPnL = position.realizedPnL + position.unrealizedPnL;
    const roi = this.calculateROI(position, totalPnL);
    const holdingPeriod = this.calculateHoldingPeriod(position);
    const maxDrawdown = await this.calculateMaxDrawdown(positionId);

    return {
      positionId,
      totalPnL,
      unrealizedPnL: position.unrealizedPnL,
      realizedPnL: position.realizedPnL,
      roi,
      holdingPeriod,
      maxDrawdown,
      executionCount: executions.length
    };
  }

  private calculateCommission(price: number, size: number): number {
    const notionalValue = price * size;
    return notionalValue * this.commissionRate;
  }

  private calculateROI(position: Position, totalPnL: number): number {
    if (position.marginUsed === 0) {
      return 0;
    }
    
    return (totalPnL / position.marginUsed) * 100;
  }

  private calculateHoldingPeriod(position: Position): number {
    const endTime = position.closedAt || new Date();
    const startTime = position.openedAt;
    
    // Return holding period in hours
    return (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  }

  private async calculateMaxDrawdown(positionId: string): Promise<number> {
    // This would require historical PnL data to calculate properly
    // For now, return 0 as a placeholder
    // Full implementation would track PnL over time and find maximum drawdown
    return 0;
  }

  /**
   * Calculate realized PnL for a position closure
   */
  calculateClosurePnL(
    entryPrice: number,
    exitPrice: number,
    size: number,
    side: 'BUY' | 'SELL'
  ): number {
    const priceDiff = side === 'BUY' 
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

    const grossPnL = priceDiff * size;
    
    // Subtract commissions for both entry and exit
    const entryCommission = this.calculateCommission(entryPrice, size);
    const exitCommission = this.calculateCommission(exitPrice, size);
    
    return grossPnL - entryCommission - exitCommission;
  }

  /**
   * Calculate partial closure PnL
   */
  calculatePartialClosurePnL(
    entryPrice: number,
    exitPrice: number,
    closedSize: number,
    side: 'BUY' | 'SELL'
  ): number {
    const priceDiff = side === 'BUY' 
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

    const grossPnL = priceDiff * closedSize;
    
    // Only subtract exit commission for partial closure
    const exitCommission = this.calculateCommission(exitPrice, closedSize);
    
    return grossPnL - exitCommission;
  }

  /**
   * Calculate margin requirement for a position
   */
  calculateMarginRequirement(
    price: number,
    size: number,
    leverage: number
  ): number {
    const notionalValue = price * size;
    return notionalValue / leverage;
  }

  /**
   * Calculate position value at current market price
   */
  calculatePositionValue(
    currentPrice: number,
    size: number
  ): number {
    return currentPrice * size;
  }
}