/**
 * Execution Engine Service - Main orchestrator for trade execution
 */

import { ExecutionEngine } from '../interfaces/execution-engine.interface';
import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { RiskValidatorService } from './risk-validator.service';
import { OrderManagerService } from './order-manager.service';
import { PositionManagerService } from './position-manager.service';
import { TradeLifecycleService } from './trade-lifecycle.service';
import { TradeEventLoggerService } from './trade-event-logger.service';
import { BrokerFactory } from '../adapters/broker-factory';
import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionResult, 
  ExecutionTradeStatus, 
  Position, 
  TradeSignal,
  ExecutionTrade,
  ExecutionMode 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export class ExecutionEngineService implements ExecutionEngine {
  private brokerAdapter: BrokerAdapter;
  private riskValidator: RiskValidatorService;
  private orderManager: OrderManagerService;
  private positionManager: PositionManagerService;
  private tradeLifecycle: TradeLifecycleService;
  private eventLogger: TradeEventLoggerService;

  constructor(executionMode: ExecutionMode = 'PAPER') {
    // Initialize broker adapter
    this.brokerAdapter = BrokerFactory.createBrokerAdapter({
      executionMode
    });

    // Initialize services
    this.riskValidator = new RiskValidatorService();
    this.orderManager = new OrderManagerService(this.brokerAdapter);
    this.positionManager = new PositionManagerService();
    this.tradeLifecycle = new TradeLifecycleService();
    this.eventLogger = new TradeEventLoggerService();

    logger.info('Execution engine initialized', { executionMode });
  }

  /**
   * Process a strategy signal and execute the trade
   */
  async processSignal(signalId: string): Promise<ExecutionResult> {
    try {
      logger.info('Processing trade signal', { signalId });

      // Get trade signal from database
      const signal = await this.getTradeSignal(signalId);
      if (!signal) {
        throw new Error(`Trade signal ${signalId} not found`);
      }

      // Ensure broker is connected
      await this.ensureBrokerConnection();

      // Get account information
      const accountInfo = await this.brokerAdapter.validateAccount();

      // Validate trade against risk limits
      const riskValidation = await this.riskValidator.validateTrade(signal, accountInfo.balance);
      
      if (!riskValidation.approved) {
        logger.warn('Trade signal rejected by risk validator', {
          signalId,
          violations: riskValidation.violations.map(v => v.description)
        });

        return {
          success: false,
          tradeId: '',
          status: 'NEW',
          error: `Risk validation failed: ${riskValidation.violations.map(v => v.description).join(', ')}`,
          timestamp: new Date()
        };
      }

      // Create execution trade record
      const executionTrade = await this.createExecutionTrade(signal, riskValidation);

      // Log trade creation event
      await this.eventLogger.logTradeCreated(executionTrade.id, {
        signalId,
        riskValidation
      });

      // Transition to VALIDATED status
      const validationTransition = this.tradeLifecycle.transitionTo(
        executionTrade.id,
        'NEW',
        'VALIDATED'
      );

      if (!validationTransition.success) {
        throw new Error(`Failed to transition to VALIDATED: ${validationTransition.error}`);
      }

      // Update trade status in database
      await this.updateTradeStatus(executionTrade.id, 'VALIDATED');

      // Log validation event
      await this.eventLogger.logTradeValidated(executionTrade.id, riskValidation);

      // Place order
      const orderId = await this.orderManager.placeOrder(executionTrade);

      // Log order sent event
      await this.eventLogger.logOrderSent(executionTrade.id, orderId);

      // Transition to ORDER_PLACED status
      const orderTransition = this.tradeLifecycle.transitionTo(
        executionTrade.id,
        'VALIDATED',
        'ORDER_PLACED'
      );

      if (!orderTransition.success) {
        throw new Error(`Failed to transition to ORDER_PLACED: ${orderTransition.error}`);
      }

      // Update trade status in database
      await this.updateTradeStatus(executionTrade.id, 'ORDER_PLACED');

      // Subscribe to execution reports for this trade
      this.brokerAdapter.subscribeToExecutions(async (execution) => {
        await this.handleExecutionReport(execution, executionTrade.id);
      });

      logger.info('Trade signal processed successfully', {
        signalId,
        tradeId: executionTrade.id,
        orderId,
        status: 'ORDER_PLACED'
      });

      return {
        success: true,
        tradeId: executionTrade.id,
        status: 'ORDER_PLACED',
        orderId,
        timestamp: new Date()
      };

    } catch (error) {
      logger.error('Failed to process trade signal', {
        signalId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        tradeId: '',
        status: 'NEW',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Get the current execution status of a trade
   */
  async getExecutionStatus(tradeId: string): Promise<ExecutionTradeStatus> {
    try {
      const trade = await this.getExecutionTrade(tradeId);
      if (!trade) {
        throw new Error(`Execution trade ${tradeId} not found`);
      }

      return trade.status;

    } catch (error) {
      logger.error('Failed to get execution status', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cancel an active trade
   */
  async cancelTrade(tradeId: string): Promise<void> {
    try {
      logger.info('Cancelling trade', { tradeId });

      const trade = await this.getExecutionTrade(tradeId);
      if (!trade) {
        throw new Error(`Execution trade ${tradeId} not found`);
      }

      // Check if trade can be cancelled
      if (!this.tradeLifecycle.canBeCancelled(trade.status)) {
        throw new Error(`Trade ${tradeId} cannot be cancelled in status ${trade.status}`);
      }

      // Get orders for this trade and cancel them
      const orders = await this.orderManager.getOrdersForTrade(tradeId);
      for (const order of orders) {
        if (order.status !== 'FILLED' && order.status !== 'CANCELLED') {
          await this.orderManager.cancelOrder(order.id);
        }
      }

      // Update trade status to closed with manual reason
      await this.updateTradeStatus(tradeId, 'CLOSED', 'MANUAL');

      // Log manual close event
      await this.eventLogger.logManualClose(tradeId, {
        reason: 'TRADE_CANCELLED',
        timestamp: new Date()
      });

      logger.info('Trade cancelled successfully', { tradeId });

    } catch (error) {
      logger.error('Failed to cancel trade', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all active positions
   */
  async getActivePositions(): Promise<Position[]> {
    try {
      return await this.positionManager.getOpenPositions();
    } catch (error) {
      logger.error('Failed to get active positions', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Handle execution report from broker
   */
  private async handleExecutionReport(execution: any, tradeId: string): Promise<void> {
    try {
      logger.info('Handling execution report', {
        tradeId,
        orderId: execution.orderId,
        filledPrice: execution.filledPrice,
        filledSize: execution.filledSize
      });

      // Handle the execution through order manager
      await this.orderManager.handleExecution(execution);

      // Get the execution trade
      const trade = await this.getExecutionTrade(tradeId);
      if (!trade) {
        logger.error('Trade not found for execution report', { tradeId });
        return;
      }

      // Transition to FILLED status
      const fillTransition = this.tradeLifecycle.transitionTo(
        tradeId,
        trade.status,
        'FILLED'
      );

      if (!fillTransition.success) {
        logger.error('Failed to transition to FILLED', {
          tradeId,
          currentStatus: trade.status,
          error: fillTransition.error
        });
        return;
      }

      // Update trade status in database
      await this.updateTradeStatus(tradeId, 'FILLED');

      // Create position
      const positionId = await this.positionManager.openPosition(trade, execution);

      // Transition to OPEN status
      const openTransition = this.tradeLifecycle.transitionTo(
        tradeId,
        'FILLED',
        'OPEN'
      );

      if (!openTransition.success) {
        logger.error('Failed to transition to OPEN', {
          tradeId,
          error: openTransition.error
        });
        return;
      }

      // Update trade status in database
      await this.updateTradeStatus(tradeId, 'OPEN');

      // Log position opened event
      await this.eventLogger.logPositionOpened(tradeId, positionId, {
        execution,
        positionId
      });

      logger.info('Execution report handled successfully', {
        tradeId,
        positionId,
        status: 'OPEN'
      });

    } catch (error) {
      logger.error('Failed to handle execution report', {
        tradeId,
        execution,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Log error event
      await this.eventLogger.logError(tradeId, {
        error: error instanceof Error ? error.message : 'Unknown error',
        context: 'EXECUTION_REPORT_HANDLING',
        execution
      });
    }
  }

  /**
   * Ensure broker connection
   */
  private async ensureBrokerConnection(): Promise<void> {
    if (!this.brokerAdapter.isAdapterConnected()) {
      logger.info('Connecting to broker');
      await this.brokerAdapter.connect();
    }
  }

  /**
   * Get trade signal from database
   */
  private async getTradeSignal(signalId: string): Promise<TradeSignal | null> {
    try {
      logger.debug('Getting Supabase client');
      const supabase = getSupabaseClient();
      
      if (!supabase) {
        throw new Error('Supabase client is null');
      }

      logger.debug('Querying trade signal', { signalId });
      const { data, error } = await supabase
        .from('trade_signals')
        .select('*')
        .eq('id', signalId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          logger.debug('No trade signal found', { signalId });
          return null;
        }
        throw new Error(`Failed to get trade signal: ${error.message}`);
      }

      logger.debug('Trade signal retrieved successfully', { signalId, data });
      return {
        id: data.id,
        strategyDecisionId: data.strategy_decision_id,
        direction: data.direction,
        entryPrice: data.entry_price,
        stopLoss: data.stop_loss,
        takeProfit: data.take_profit,
        rrRatio: data.rr_ratio,
        riskPercent: data.risk_percent,
        leverage: data.leverage,
        positionSize: data.position_size,
        marginRequired: data.margin_required,
        candleTimestamp: new Date(data.candle_timestamp),
        createdAt: new Date(data.created_at)
      };
    } catch (error) {
      logger.error('Error in getTradeSignal', {
        signalId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Create execution trade record
   */
  private async createExecutionTrade(signal: TradeSignal, riskValidation: any): Promise<ExecutionTrade> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_trades')
      .insert([{
        trade_signal_id: signal.id,
        pair: 'XAUUSD', // This should come from the signal
        timeframe: 'M15', // This should come from the signal
        side: signal.direction,
        status: 'NEW',
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        position_size: riskValidation.adjustedPositionSize || signal.positionSize,
        risk_percent: signal.riskPercent,
        leverage: signal.leverage,
        rr: signal.rrRatio,
        execution_mode: 'PAPER' // This should be configurable
      }])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create execution trade: ${error.message}`);
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

  /**
   * Get execution trade by ID
   */
  private async getExecutionTrade(tradeId: string): Promise<ExecutionTrade | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('execution_trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null;
      }
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

  /**
   * Update trade status in database
   */
  private async updateTradeStatus(
    tradeId: string, 
    status: ExecutionTradeStatus, 
    closeReason?: string
  ): Promise<void> {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'OPEN') {
      updateData.opened_at = new Date().toISOString();
    }

    if (status === 'CLOSED') {
      updateData.closed_at = new Date().toISOString();
      if (closeReason) {
        updateData.close_reason = closeReason;
      }
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('execution_trades')
      .update(updateData)
      .eq('id', tradeId);

    if (error) {
      throw new Error(`Failed to update trade status: ${error.message}`);
    }
  }

  /**
   * Get execution engine statistics
   */
  async getExecutionStats(): Promise<{
    totalTrades: number;
    activeTrades: number;
    activePositions: number;
    successRate: number;
  }> {
    try {
      const supabase = getSupabaseClient();
      
      // Get total trades
      const { count: totalTrades } = await supabase
        .from('execution_trades')
        .select('*', { count: 'exact', head: true });

      // Get active trades
      const { count: activeTrades } = await supabase
        .from('execution_trades')
        .select('*', { count: 'exact', head: true })
        .in('status', ['NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN']);

      // Get active positions
      const activePositions = await this.getActivePositions();

      // Calculate success rate (closed trades with TP)
      const { count: successfulTrades } = await supabase
        .from('execution_trades')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'CLOSED')
        .eq('close_reason', 'TP');

      const { count: closedTrades } = await supabase
        .from('execution_trades')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'CLOSED');

      const successRate = closedTrades && closedTrades > 0 
        ? ((successfulTrades || 0) / closedTrades) * 100 
        : 0;

      return {
        totalTrades: totalTrades || 0,
        activeTrades: activeTrades || 0,
        activePositions: activePositions.length,
        successRate: Math.round(successRate * 100) / 100
      };

    } catch (error) {
      logger.error('Failed to get execution stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}