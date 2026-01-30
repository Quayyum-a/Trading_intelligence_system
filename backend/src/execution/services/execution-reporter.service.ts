/**
 * Execution Reporter Service - Provides execution status tracking and reporting
 */

import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionTrade, 
  ExecutionTradeStatus, 
  Position, 
  ExecutionTradeEvent,
  ExecutionCloseReason 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface ExecutionStatusReport {
  tradeId: string;
  currentStatus: ExecutionTradeStatus;
  statusHistory: ExecutionTradeEvent[];
  position?: Position;
  timeline: {
    created: Date;
    validated?: Date;
    orderPlaced?: Date;
    filled?: Date;
    opened?: Date;
    closed?: Date;
  };
  performance?: {
    unrealizedPnL?: number;
    realizedPnL?: number;
    holdingPeriod?: number;
    riskRewardAchieved?: number;
  };
}

export interface ExecutionSummaryReport {
  totalTrades: number;
  activetrades: number;
  completedTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  averageHoldingTime: number;
  totalRealizedPnL: number;
  totalUnrealizedPnL: number;
  statusBreakdown: Record<ExecutionTradeStatus, number>;
  closeReasonBreakdown: Record<ExecutionCloseReason, number>;
}

export interface ExecutionPerformanceReport {
  period: string;
  totalTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalReturn: number;
  bestTrade: number;
  worstTrade: number;
  averageHoldingTime: number;
}

export class ExecutionReporterService {
  /**
   * Get detailed status report for a specific trade
   */
  async getTradeStatusReport(tradeId: string): Promise<ExecutionStatusReport> {
    try {
      logger.info('Generating trade status report', { tradeId });

      // Get execution trade
      const trade = await this.getExecutionTrade(tradeId);
      if (!trade) {
        throw new Error(`Execution trade ${tradeId} not found`);
      }

      // Get trade events (status history)
      const events = await this.getTradeEvents(tradeId);

      // Get position if trade is filled/open
      let position: Position | undefined;
      if (['FILLED', 'OPEN', 'CLOSED'].includes(trade.status)) {
        position = await this.getPositionForTrade(tradeId);
      }

      // Build timeline from events
      const timeline = this.buildTimeline(trade, events);

      // Calculate performance metrics if applicable
      const performance = await this.calculateTradePerformance(trade, position);

      const report: ExecutionStatusReport = {
        tradeId,
        currentStatus: trade.status,
        statusHistory: events,
        position,
        timeline,
        performance
      };

      logger.info('Trade status report generated', {
        tradeId,
        currentStatus: trade.status,
        eventsCount: events.length
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate trade status report', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get execution summary report
   */
  async getExecutionSummary(timeframe?: { start: Date; end: Date }): Promise<ExecutionSummaryReport> {
    try {
      logger.info('Generating execution summary report', { timeframe });

      const supabase = getSupabaseClient();
      let query = supabase.from('execution_trades').select('*');
      
      if (timeframe) {
        query = query
          .gte('created_at', timeframe.start.toISOString())
          .lte('created_at', timeframe.end.toISOString());
      }

      const { data: trades, error } = await query;

      if (error) {
        throw new Error(`Failed to get trades for summary: ${error.message}`);
      }

      const allTrades = trades || [];
      
      // Calculate basic metrics
      const totalTrades = allTrades.length;
      const activeTradesCount = allTrades.filter(t => 
        ['NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN'].includes(t.status)
      ).length;
      const completedTrades = allTrades.filter(t => t.status === 'CLOSED').length;
      const successfulTrades = allTrades.filter(t => t.status === 'CLOSED' && t.close_reason === 'TP').length;
      const failedTrades = allTrades.filter(t => t.status === 'CLOSED' && t.close_reason === 'SL').length;
      
      const successRate = completedTrades > 0 ? (successfulTrades / completedTrades) * 100 : 0;

      // Calculate average holding time for closed trades
      const closedTrades = allTrades.filter(t => t.status === 'CLOSED' && t.opened_at && t.closed_at);
      const averageHoldingTime = closedTrades.length > 0 
        ? closedTrades.reduce((sum, trade) => {
            const holdingTime = (new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()) / (1000 * 60 * 60);
            return sum + holdingTime;
          }, 0) / closedTrades.length
        : 0;

      // Get PnL data
      const { totalRealizedPnL, totalUnrealizedPnL } = await this.calculatePnLSummary(timeframe);

      // Status breakdown
      const statusBreakdown: Record<ExecutionTradeStatus, number> = {
        'NEW': 0,
        'VALIDATED': 0,
        'ORDER_PLACED': 0,
        'PARTIALLY_FILLED': 0,
        'FILLED': 0,
        'OPEN': 0,
        'CLOSED': 0
      };

      allTrades.forEach(trade => {
        statusBreakdown[trade.status as ExecutionTradeStatus]++;
      });

      // Close reason breakdown
      const closeReasonBreakdown: Record<ExecutionCloseReason, number> = {
        'TP': 0,
        'SL': 0,
        'MANUAL': 0,
        'ERROR': 0
      };

      allTrades.filter(t => t.close_reason).forEach(trade => {
        closeReasonBreakdown[trade.close_reason as ExecutionCloseReason]++;
      });

      const summary: ExecutionSummaryReport = {
        totalTrades,
        activeTradesCount,
        completedTrades,
        successfulTrades,
        failedTrades,
        successRate: Math.round(successRate * 100) / 100,
        averageHoldingTime: Math.round(averageHoldingTime * 100) / 100,
        totalRealizedPnL: Math.round(totalRealizedPnL * 100) / 100,
        totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
        statusBreakdown,
        closeReasonBreakdown
      };

      logger.info('Execution summary report generated', {
        totalTrades,
        activeTradesCount,
        completedTrades,
        successRate
      });

      return summary;

    } catch (error) {
      logger.error('Failed to generate execution summary', {
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get execution performance report
   */
  async getPerformanceReport(period: 'day' | 'week' | 'month' | 'year' = 'month'): Promise<ExecutionPerformanceReport> {
    try {
      logger.info('Generating execution performance report', { period });

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      
      switch (period) {
        case 'day':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      // Get closed trades in the period
      const { data: trades, error } = await supabase
        .from('execution_trades')
        .select('*')
        .eq('status', 'CLOSED')
        .gte('closed_at', startDate.toISOString())
        .lte('closed_at', endDate.toISOString());

      if (error) {
        throw new Error(`Failed to get trades for performance report: ${error.message}`);
      }

      const closedTrades = trades || [];
      
      if (closedTrades.length === 0) {
        return this.getEmptyPerformanceReport(period);
      }

      // Get corresponding positions for PnL calculation
      const tradeIds = closedTrades.map(t => t.id);
      const { data: positions } = await supabase
        .from('positions')
        .select('*')
        .in('execution_trade_id', tradeIds);

      const positionMap = new Map((positions || []).map(p => [p.execution_trade_id, p]));

      // Calculate performance metrics
      const winningTrades = closedTrades.filter(t => t.close_reason === 'TP');
      const losingTrades = closedTrades.filter(t => t.close_reason === 'SL');
      
      const winRate = (winningTrades.length / closedTrades.length) * 100;

      // Calculate PnL for each trade (simplified calculation)
      const tradePnLs = closedTrades.map(trade => {
        const position = positionMap.get(trade.id);
        if (!position) return 0;
        
        // Simplified PnL calculation - in real implementation, this would use actual close prices
        const priceDiff = position.side === 'BUY' 
          ? trade.take_profit - position.avg_entry_price
          : position.avg_entry_price - trade.take_profit;
        
        return trade.close_reason === 'TP' ? Math.abs(priceDiff * position.size) : -Math.abs(priceDiff * position.size);
      });

      const winningPnLs = tradePnLs.filter(pnl => pnl > 0);
      const losingPnLs = tradePnLs.filter(pnl => pnl < 0);

      const averageWin = winningPnLs.length > 0 
        ? winningPnLs.reduce((sum, pnl) => sum + pnl, 0) / winningPnLs.length 
        : 0;
      
      const averageLoss = losingPnLs.length > 0 
        ? Math.abs(losingPnLs.reduce((sum, pnl) => sum + pnl, 0) / losingPnLs.length)
        : 0;

      const profitFactor = averageLoss > 0 ? averageWin / averageLoss : 0;
      const totalReturn = tradePnLs.reduce((sum, pnl) => sum + pnl, 0);
      const bestTrade = Math.max(...tradePnLs);
      const worstTrade = Math.min(...tradePnLs);

      // Calculate average holding time
      const averageHoldingTime = closedTrades.reduce((sum, trade) => {
        if (!trade.opened_at || !trade.closed_at) return sum;
        const holdingTime = (new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()) / (1000 * 60 * 60);
        return sum + holdingTime;
      }, 0) / closedTrades.length;

      // Calculate max drawdown (simplified)
      let runningPnL = 0;
      let peak = 0;
      let maxDrawdown = 0;

      for (const pnl of tradePnLs) {
        runningPnL += pnl;
        if (runningPnL > peak) {
          peak = runningPnL;
        }
        const drawdown = peak - runningPnL;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      // Calculate Sharpe ratio (simplified)
      const returns = tradePnLs.map(pnl => pnl / 10000); // Normalize to percentage
      const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

      const report: ExecutionPerformanceReport = {
        period,
        totalTrades: closedTrades.length,
        winRate: Math.round(winRate * 100) / 100,
        averageWin: Math.round(averageWin * 100) / 100,
        averageLoss: Math.round(averageLoss * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        sharpeRatio: Math.round(sharpeRatio * 100) / 100,
        totalReturn: Math.round(totalReturn * 100) / 100,
        bestTrade: Math.round(bestTrade * 100) / 100,
        worstTrade: Math.round(worstTrade * 100) / 100,
        averageHoldingTime: Math.round(averageHoldingTime * 100) / 100
      };

      logger.info('Execution performance report generated', {
        period,
        totalTrades: closedTrades.length,
        winRate,
        totalReturn
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate performance report', {
        period,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get real-time execution status for all active trades
   */
  async getActiveTradesStatus(): Promise<ExecutionStatusReport[]> {
    try {
      const { data: activeTrades, error } = await supabase
        .from('execution_trades')
        .select('*')
        .in('status', ['NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN'])
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get active trades: ${error.message}`);
      }

      const reports: ExecutionStatusReport[] = [];

      for (const trade of activeTrades || []) {
        try {
          const report = await this.getTradeStatusReport(trade.id);
          reports.push(report);
        } catch (error) {
          logger.warn('Failed to generate report for trade', {
            tradeId: trade.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return reports;

    } catch (error) {
      logger.error('Failed to get active trades status', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Helper methods
   */

  private async getExecutionTrade(tradeId: string): Promise<ExecutionTrade | null> {
    const { data, error } = await supabase
      .from('execution_trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get execution trade: ${error.message}`);
    }

    return {
      id: data.id,
      tradeSignalId: data.trade_signal_id,
      pair: data.pair,
      timeframe: data.timeframe,
      side: data.side,
      status: data.status,
      entryPrice: data.entry_price,
      stopLoss: data.stop_loss,
      takeProfit: data.take_profit,
      positionSize: data.position_size,
      riskPercent: data.risk_percent,
      leverage: data.leverage,
      rr: data.rr,
      executionMode: data.execution_mode,
      openedAt: data.opened_at ? new Date(data.opened_at) : undefined,
      closedAt: data.closed_at ? new Date(data.closed_at) : undefined,
      closeReason: data.close_reason,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  private async getTradeEvents(tradeId: string): Promise<ExecutionTradeEvent[]> {
    const { data, error } = await supabase
      .from('execution_trade_events')
      .select('*')
      .eq('execution_trade_id', tradeId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to get trade events: ${error.message}`);
    }

    return (data || []).map(row => ({
      id: row.id,
      executionTradeId: row.execution_trade_id,
      eventType: row.event_type,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at)
    }));
  }

  private async getPositionForTrade(tradeId: string): Promise<Position | null> {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('execution_trade_id', tradeId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get position: ${error.message}`);
    }

    return {
      id: data.id,
      executionTradeId: data.execution_trade_id,
      side: data.side,
      size: data.size,
      avgEntryPrice: data.avg_entry_price,
      stopLoss: data.stop_loss,
      takeProfit: data.take_profit,
      marginUsed: data.margin_used,
      leverage: data.leverage,
      openedAt: new Date(data.opened_at),
      closedAt: data.closed_at ? new Date(data.closed_at) : undefined,
      createdAt: new Date(data.created_at)
    };
  }

  private buildTimeline(trade: ExecutionTrade, events: ExecutionTradeEvent[]) {
    const timeline: any = {
      created: trade.createdAt
    };

    events.forEach(event => {
      switch (event.eventType) {
        case 'VALIDATED':
          timeline.validated = event.createdAt;
          break;
        case 'ORDER_SENT':
          timeline.orderPlaced = event.createdAt;
          break;
        case 'FILLED':
          timeline.filled = event.createdAt;
          break;
        case 'OPENED':
          timeline.opened = event.createdAt;
          break;
        case 'CLOSED':
        case 'TP_HIT':
        case 'SL_HIT':
        case 'MANUAL_CLOSE':
          timeline.closed = event.createdAt;
          break;
      }
    });

    return timeline;
  }

  private async calculateTradePerformance(trade: ExecutionTrade, position?: Position) {
    if (!position) return undefined;

    const performance: any = {};

    if (trade.status === 'OPEN') {
      // Calculate unrealized PnL (simplified)
      const currentPrice = position.avgEntryPrice; // In real implementation, use current market price
      const priceDiff = position.side === 'BUY' 
        ? currentPrice - position.avgEntryPrice
        : position.avgEntryPrice - currentPrice;
      performance.unrealizedPnL = priceDiff * position.size;
    }

    if (trade.status === 'CLOSED' && trade.closedAt && trade.openedAt) {
      // Calculate realized PnL (simplified)
      const closePrice = trade.closeReason === 'TP' ? trade.takeProfit : trade.stopLoss;
      const priceDiff = position.side === 'BUY' 
        ? closePrice - position.avgEntryPrice
        : position.avgEntryPrice - closePrice;
      performance.realizedPnL = priceDiff * position.size;

      // Calculate holding period
      performance.holdingPeriod = (trade.closedAt.getTime() - trade.openedAt.getTime()) / (1000 * 60 * 60);

      // Calculate risk-reward achieved
      const riskDistance = Math.abs(position.avgEntryPrice - trade.stopLoss);
      const rewardDistance = Math.abs(closePrice - position.avgEntryPrice);
      performance.riskRewardAchieved = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    }

    return performance;
  }

  private async calculatePnLSummary(timeframe?: { start: Date; end: Date }) {
    // Simplified PnL calculation - in real implementation, this would be more sophisticated
    return {
      totalRealizedPnL: 0,
      totalUnrealizedPnL: 0
    };
  }

  private getEmptyPerformanceReport(period: string): ExecutionPerformanceReport {
    return {
      period,
      totalTrades: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      totalReturn: 0,
      bestTrade: 0,
      worstTrade: 0,
      averageHoldingTime: 0
    };
  }
}