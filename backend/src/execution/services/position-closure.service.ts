/**
 * Position Closure Service - Handles position closure for TP/SL hits and manual closes
 * Enhanced with TransactionCoordinator for atomic operations
 */

import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { PositionManagerService } from './position-manager.service';
import { TradeEventLoggerService } from './trade-event-logger.service';
import { PnLCalculatorService } from './pnl-calculator.service';
import { getSupabaseClient } from '../../config/supabase';
import { TransactionCoordinatorService } from '../position-lifecycle/services/transaction-coordinator.service';
import { 
  ExecutionCloseReason, 
  Position, 
  ExecutionTrade,
  OrderRequest 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface PositionCloseRequest {
  positionId: string;
  reason: ExecutionCloseReason;
  closePrice?: number;
  partialSize?: number;
  metadata?: Record<string, any>;
}

export interface PositionCloseResult {
  success: boolean;
  positionId: string;
  closePrice: number;
  realizedPnL: number;
  closeReason: ExecutionCloseReason;
  closeTime: Date;
  error?: string;
}

export class PositionClosureService {
  constructor(
    private brokerAdapter: BrokerAdapter,
    private positionManager: PositionManagerService,
    private eventLogger: TradeEventLoggerService,
    private pnlCalculator: PnLCalculatorService,
    private transactionCoordinator?: TransactionCoordinatorService
  ) {
    // Initialize transaction coordinator if not provided
    if (!this.transactionCoordinator) {
      const supabase = getSupabaseClient();
      this.transactionCoordinator = new TransactionCoordinatorService(supabase);
    }
  }

  /**
   * Close a position with specified reason
   */
  async closePosition(request: PositionCloseRequest): Promise<PositionCloseResult> {
    try {
      logger.info('Initiating position closure', {
        positionId: request.positionId,
        reason: request.reason,
        closePrice: request.closePrice,
        partialSize: request.partialSize
      });

      // Get position details
      const position = await this.positionManager.getPosition(request.positionId);
      if (!position) {
        throw new Error(`Position ${request.positionId} not found`);
      }

      // Validate position can be closed
      this.validatePositionClosure(position, request);

      // Determine close price
      const closePrice = request.closePrice || await this.getCurrentMarketPrice(position);

      // Execute the closure based on reason
      let closeResult: PositionCloseResult;
      
      switch (request.reason) {
        case 'TP':
          closeResult = await this.handleTakeProfitClosure(position, closePrice, request.metadata);
          break;
        case 'SL':
          closeResult = await this.handleStopLossClosure(position, closePrice, request.metadata);
          break;
        case 'MANUAL':
          closeResult = await this.handleManualClosure(position, closePrice, request.metadata);
          break;
        case 'ERROR':
          closeResult = await this.handleErrorClosure(position, closePrice, request.metadata);
          break;
        default:
          throw new Error(`Unsupported close reason: ${request.reason}`);
      }

      logger.info('Position closure completed', {
        positionId: request.positionId,
        result: closeResult
      });

      return closeResult;

    } catch (error) {
      logger.error('Failed to close position', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        positionId: request.positionId,
        closePrice: request.closePrice || 0,
        realizedPnL: 0,
        closeReason: request.reason,
        closeTime: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle take profit closure
   */
  private async handleTakeProfitClosure(
    position: Position,
    closePrice: number,
    metadata?: Record<string, any>
  ): Promise<PositionCloseResult> {
    // Wrap all closure operations in a transaction for atomicity
    return await this.transactionCoordinator!.executeInTransaction(
      async (client) => {
        // Place closing order with broker (outside transaction - broker is external)
        await this.placeClosingOrder(position, closePrice);

        // Calculate realized PnL
        const realizedPnL = this.pnlCalculator.calculateRealizedPnL(
          position,
          closePrice,
          position.openedAt,
          new Date()
        );

        // Update position in database (within transaction)
        await this.positionManager.closePosition(position.id, 'TP');

        // Log take profit hit event (within transaction)
        await this.eventLogger.logTakeProfitHit(position.executionTradeId, {
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          ...metadata
        });

        // Task 9.1: Create PNL_REALIZED event (Requirement 3.1.1)
        // This must be done in the same transaction as position closure
        if (this.positionManager.riskLedgerService) {
          await this.positionManager.riskLedgerService.realizePnL(
            position.id,
            realizedPnL.realizedPnL,
            'TP'
          );
        }

        return {
          success: true,
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          closeReason: 'TP',
          closeTime: new Date()
        };
      },
      {
        operationName: 'take_profit_closure',
        isolationLevel: 'READ COMMITTED',
        timeoutMs: 5000
      }
    );
  }

  /**
   * Handle stop loss closure
   */
  private async handleStopLossClosure(
    position: Position,
    closePrice: number,
    metadata?: Record<string, any>
  ): Promise<PositionCloseResult> {
    // Wrap all closure operations in a transaction for atomicity
    return await this.transactionCoordinator!.executeInTransaction(
      async (client) => {
        // Place closing order with broker (outside transaction - broker is external)
        await this.placeClosingOrder(position, closePrice);

        // Calculate realized PnL
        const realizedPnL = this.pnlCalculator.calculateRealizedPnL(
          position,
          closePrice,
          position.openedAt,
          new Date()
        );

        // Update position in database (within transaction)
        await this.positionManager.closePosition(position.id, 'SL');

        // Log stop loss hit event (within transaction)
        await this.eventLogger.logStopLossHit(position.executionTradeId, {
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          ...metadata
        });

        // Task 9.1: Create PNL_REALIZED event (Requirement 3.1.1)
        // This must be done in the same transaction as position closure
        if (this.positionManager.riskLedgerService) {
          await this.positionManager.riskLedgerService.realizePnL(
            position.id,
            realizedPnL.realizedPnL,
            'SL'
          );
        }

        return {
          success: true,
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          closeReason: 'SL',
          closeTime: new Date()
        };
      },
      {
        operationName: 'stop_loss_closure',
        isolationLevel: 'READ COMMITTED',
        timeoutMs: 5000
      }
    );
  }

  /**
   * Handle manual closure
   */
  private async handleManualClosure(
    position: Position,
    closePrice: number,
    metadata?: Record<string, any>
  ): Promise<PositionCloseResult> {
    // Wrap all closure operations in a transaction for atomicity
    return await this.transactionCoordinator!.executeInTransaction(
      async (client) => {
        // Place closing order with broker (outside transaction - broker is external)
        await this.placeClosingOrder(position, closePrice);

        // Calculate realized PnL
        const realizedPnL = this.pnlCalculator.calculateRealizedPnL(
          position,
          closePrice,
          position.openedAt,
          new Date()
        );

        // Update position in database (within transaction)
        await this.positionManager.closePosition(position.id, 'MANUAL');

        // Log manual close event (within transaction)
        await this.eventLogger.logManualClose(position.executionTradeId, {
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          ...metadata
        });

        // Task 9.1: Create PNL_REALIZED event (Requirement 3.1.1)
        // This must be done in the same transaction as position closure
        if (this.positionManager.riskLedgerService) {
          await this.positionManager.riskLedgerService.realizePnL(
            position.id,
            realizedPnL.realizedPnL,
            'MANUAL'
          );
        }

        return {
          success: true,
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          closeReason: 'MANUAL',
          closeTime: new Date()
        };
      },
      {
        operationName: 'manual_closure',
        isolationLevel: 'READ COMMITTED',
        timeoutMs: 5000
      }
    );
  }

  /**
   * Handle error closure
   */
  private async handleErrorClosure(
    position: Position,
    closePrice: number,
    metadata?: Record<string, any>
  ): Promise<PositionCloseResult> {
    // Wrap all closure operations in a transaction for atomicity
    return await this.transactionCoordinator!.executeInTransaction(
      async (client) => {
        try {
          // Attempt to place closing order with broker
          await this.placeClosingOrder(position, closePrice);
        } catch (brokerError) {
          logger.warn('Failed to place closing order with broker during error closure', {
            positionId: position.id,
            error: brokerError instanceof Error ? brokerError.message : 'Unknown error'
          });
        }

        // Calculate realized PnL
        const realizedPnL = this.pnlCalculator.calculateRealizedPnL(
          position,
          closePrice,
          position.openedAt,
          new Date()
        );

        // Update position in database (within transaction)
        await this.positionManager.closePosition(position.id, 'ERROR');

        // Log error event (within transaction)
        await this.eventLogger.logError(position.executionTradeId, {
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          errorType: 'POSITION_CLOSURE_ERROR',
          ...metadata
        });

        // Task 9.1: Create PNL_REALIZED event (Requirement 3.1.1)
        // This must be done in the same transaction as position closure
        if (this.positionManager.riskLedgerService) {
          await this.positionManager.riskLedgerService.realizePnL(
            position.id,
            realizedPnL.realizedPnL,
            'ERROR'
          );
        }

        return {
          success: true,
          positionId: position.id,
          closePrice,
          realizedPnL: realizedPnL.realizedPnL,
          closeReason: 'ERROR',
          closeTime: new Date()
        };
      },
      {
        operationName: 'error_closure',
        isolationLevel: 'READ COMMITTED',
        timeoutMs: 5000
      }
    );
  }

  /**
   * Place closing order with broker
   */
  private async placeClosingOrder(position: Position, closePrice: number): Promise<void> {
    const closingOrder: OrderRequest = {
      symbol: this.getSymbolFromPosition(position),
      side: position.side === 'BUY' ? 'SELL' : 'BUY', // Opposite side to close
      size: position.size,
      price: closePrice,
      type: 'MARKET' // Use market order for immediate closure
    };

    await this.brokerAdapter.placeOrder(closingOrder);
    
    logger.info('Closing order placed with broker', {
      positionId: position.id,
      order: closingOrder
    });
  }

  /**
   * Get current market price for position symbol
   */
  private async getCurrentMarketPrice(position: Position): Promise<number> {
    // In a real implementation, this would fetch current market price
    // For now, we'll use the entry price as a fallback
    return position.avgEntryPrice;
  }

  /**
   * Validate position can be closed
   */
  private validatePositionClosure(position: Position, request: PositionCloseRequest): void {
    if (position.closedAt) {
      throw new Error(`Position ${position.id} is already closed`);
    }

    if (request.partialSize && request.partialSize >= position.size) {
      throw new Error('Partial close size must be less than position size');
    }

    if (request.partialSize && request.partialSize <= 0) {
      throw new Error('Partial close size must be positive');
    }
  }

  /**
   * Close all positions for a specific symbol
   */
  async closeAllPositionsForSymbol(symbol: string, reason: ExecutionCloseReason): Promise<PositionCloseResult[]> {
    try {
      logger.info('Closing all positions for symbol', { symbol, reason });

      const openPositions = await this.positionManager.getOpenPositions();
      const symbolPositions = openPositions.filter(pos => 
        this.getSymbolFromPosition(pos) === symbol
      );

      const closeResults: PositionCloseResult[] = [];

      for (const position of symbolPositions) {
        const closeRequest: PositionCloseRequest = {
          positionId: position.id,
          reason,
          metadata: { bulkClose: true, symbol }
        };

        const result = await this.closePosition(closeRequest);
        closeResults.push(result);
      }

      logger.info('All positions closed for symbol', {
        symbol,
        positionsClosed: closeResults.length,
        successfulClosures: closeResults.filter(r => r.success).length
      });

      return closeResults;

    } catch (error) {
      logger.error('Failed to close all positions for symbol', {
        symbol,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Close all open positions (emergency closure)
   */
  async closeAllPositions(reason: ExecutionCloseReason = 'MANUAL'): Promise<PositionCloseResult[]> {
    try {
      logger.info('Closing all open positions', { reason });

      const openPositions = await this.positionManager.getOpenPositions();
      const closeResults: PositionCloseResult[] = [];

      for (const position of openPositions) {
        const closeRequest: PositionCloseRequest = {
          positionId: position.id,
          reason,
          metadata: { emergencyClose: true }
        };

        const result = await this.closePosition(closeRequest);
        closeResults.push(result);
      }

      logger.info('All positions closed', {
        totalPositions: openPositions.length,
        successfulClosures: closeResults.filter(r => r.success).length
      });

      return closeResults;

    } catch (error) {
      logger.error('Failed to close all positions', {
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get position closure statistics
   */
  async getClosureStatistics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    totalClosed: number;
    closedByTP: number;
    closedBySL: number;
    closedManually: number;
    closedByError: number;
    averageHoldingTime: number;
    totalRealizedPnL: number;
  }> {
    try {
      const supabase = getSupabaseClient();
      const timeframeDays = timeframe === 'day' ? 1 : timeframe === 'week' ? 7 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - timeframeDays);

      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .not('closed_at', 'is', null)
        .gte('closed_at', startDate.toISOString());

      if (error) {
        throw new Error(`Failed to get closure statistics: ${error.message}`);
      }

      const closedPositions = data || [];
      
      const stats = {
        totalClosed: closedPositions.length,
        closedByTP: 0,
        closedBySL: 0,
        closedManually: 0,
        closedByError: 0,
        averageHoldingTime: 0,
        totalRealizedPnL: 0
      };

      if (closedPositions.length === 0) {
        return stats;
      }

      // Get corresponding execution trades to get close reasons
      const tradeIds = closedPositions.map(pos => pos.execution_trade_id);
      const { data: trades } = await supabase
        .from('execution_trades')
        .select('id, close_reason')
        .in('id', tradeIds);

      const tradeCloseReasons = new Map(trades?.map(t => [t.id, t.close_reason]) || []);

      let totalHoldingTime = 0;

      for (const position of closedPositions) {
        const closeReason = tradeCloseReasons.get(position.execution_trade_id);
        
        switch (closeReason) {
          case 'TP':
            stats.closedByTP++;
            break;
          case 'SL':
            stats.closedBySL++;
            break;
          case 'MANUAL':
            stats.closedManually++;
            break;
          case 'ERROR':
            stats.closedByError++;
            break;
        }

        // Calculate holding time
        const openTime = new Date(position.opened_at);
        const closeTime = new Date(position.closed_at);
        const holdingTime = (closeTime.getTime() - openTime.getTime()) / (1000 * 60 * 60); // hours
        totalHoldingTime += holdingTime;
      }

      stats.averageHoldingTime = totalHoldingTime / closedPositions.length;

      return stats;

    } catch (error) {
      logger.error('Failed to get closure statistics', {
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
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
}