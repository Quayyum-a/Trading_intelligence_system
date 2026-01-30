/**
 * Audit Logger Service - Comprehensive audit logging for all execution activities
 */

import { getSupabaseClient } from '../../config/supabase';
import { getLogger } from '../../config/logger';
const logger = getLogger();
import { 
  TradeSignal, 
  ExecutionTrade, 
  ExecutionOrder, 
  Position, 
  ExecutionReport,
  RiskValidationResult 
} from '../types/execution.types';

export enum AuditEventType {
  SIGNAL_RECEIVED = 'SIGNAL_RECEIVED',
  SIGNAL_PROCESSED = 'SIGNAL_PROCESSED',
  RISK_VALIDATION = 'RISK_VALIDATION',
  TRADE_CREATED = 'TRADE_CREATED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_FILLED = 'ORDER_FILLED',
  POSITION_OPENED = 'POSITION_OPENED',
  POSITION_CLOSED = 'POSITION_CLOSED',
  STATE_TRANSITION = 'STATE_TRANSITION',
  ERROR_OCCURRED = 'ERROR_OCCURRED',
  RECOVERY_ACTION = 'RECOVERY_ACTION',
  CONFIGURATION_CHANGE = 'CONFIGURATION_CHANGE',
  SYSTEM_START = 'SYSTEM_START',
  SYSTEM_STOP = 'SYSTEM_STOP'
}

export interface AuditLogEntry {
  id: string;
  eventType: AuditEventType;
  timestamp: Date;
  userId?: string;
  tradeId?: string;
  positionId?: string;
  orderId?: string;
  signalId?: string;
  component: string;
  action: string;
  details: Record<string, any>;
  beforeState?: Record<string, any>;
  afterState?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
  duration?: number;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLoggerService {
  private readonly AUDIT_TABLE = 'execution_audit_log';

  /**
   * Log signal processing audit event
   */
  async logSignalProcessing(
    signalId: string,
    signal: TradeSignal,
    processingResult: any,
    duration: number
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.SIGNAL_PROCESSED,
      signalId,
      component: 'ExecutionEngine',
      action: 'processSignal',
      details: {
        signal: this.sanitizeSignalData(signal),
        processingResult,
        duration
      },
      success: processingResult.success !== false,
      errorMessage: processingResult.error,
      duration
    });
  }

  /**
   * Log risk validation audit event
   */
  async logRiskValidation(
    signalId: string,
    tradeId: string,
    validationInput: any,
    validationResult: RiskValidationResult,
    duration: number
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.RISK_VALIDATION,
      signalId,
      tradeId,
      component: 'RiskValidator',
      action: 'validateTrade',
      details: {
        input: this.sanitizeValidationInput(validationInput),
        result: validationResult,
        approved: validationResult.approved,
        violations: validationResult.violations
      },
      success: validationResult.approved,
      duration
    });
  }

  /**
   * Log trade creation audit event
   */
  async logTradeCreation(
    signalId: string,
    trade: ExecutionTrade,
    creationContext: Record<string, any>
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.TRADE_CREATED,
      signalId,
      tradeId: trade.id,
      component: 'ExecutionEngine',
      action: 'createExecutionTrade',
      details: {
        trade: this.sanitizeTradeData(trade),
        context: creationContext
      },
      afterState: {
        tradeStatus: trade.status,
        positionSize: trade.positionSize,
        riskPercent: trade.riskPercent,
        leverage: trade.leverage
      },
      success: true
    });
  }

  /**
   * Log order placement audit event
   */
  async logOrderPlacement(
    tradeId: string,
    order: ExecutionOrder,
    brokerResponse: any,
    duration: number
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.ORDER_PLACED,
      tradeId,
      orderId: order.id,
      component: 'OrderManager',
      action: 'placeOrder',
      details: {
        order: this.sanitizeOrderData(order),
        brokerResponse: this.sanitizeBrokerResponse(brokerResponse)
      },
      success: brokerResponse.status !== 'REJECTED',
      errorMessage: brokerResponse.status === 'REJECTED' ? brokerResponse.message : undefined,
      duration
    });
  }

  /**
   * Log order execution audit event
   */
  async logOrderExecution(
    tradeId: string,
    orderId: string,
    executionReport: ExecutionReport,
    processingDuration: number
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.ORDER_FILLED,
      tradeId,
      orderId,
      component: 'OrderManager',
      action: 'handleExecution',
      details: {
        execution: {
          filledPrice: executionReport.filledPrice,
          filledSize: executionReport.filledSize,
          slippage: executionReport.slippage,
          timestamp: executionReport.timestamp
        }
      },
      success: true,
      duration: processingDuration
    });
  }

  /**
   * Log position opening audit event
   */
  async logPositionOpening(
    tradeId: string,
    position: Position,
    executionReport: ExecutionReport
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.POSITION_OPENED,
      tradeId,
      positionId: position.id,
      component: 'PositionManager',
      action: 'openPosition',
      details: {
        position: this.sanitizePositionData(position),
        executionDetails: {
          filledPrice: executionReport.filledPrice,
          filledSize: executionReport.filledSize
        }
      },
      afterState: {
        positionSize: position.size,
        entryPrice: position.avgEntryPrice,
        marginUsed: position.marginUsed
      },
      success: true
    });
  }

  /**
   * Log position closure audit event
   */
  async logPositionClosure(
    tradeId: string,
    positionId: string,
    closeReason: string,
    closePrice: number,
    realizedPnL: number,
    beforeState: Record<string, any>
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.POSITION_CLOSED,
      tradeId,
      positionId,
      component: 'PositionManager',
      action: 'closePosition',
      details: {
        closeReason,
        closePrice,
        realizedPnL
      },
      beforeState,
      afterState: {
        status: 'CLOSED',
        realizedPnL
      },
      success: true
    });
  }

  /**
   * Log state transition audit event
   */
  async logStateTransition(
    tradeId: string,
    fromStatus: string,
    toStatus: string,
    transitionContext: Record<string, any>,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.STATE_TRANSITION,
      tradeId,
      component: 'TradeLifecycle',
      action: 'transitionTo',
      details: {
        transition: `${fromStatus} -> ${toStatus}`,
        context: transitionContext
      },
      beforeState: { status: fromStatus },
      afterState: success ? { status: toStatus } : { status: fromStatus },
      success,
      errorMessage
    });
  }

  /**
   * Log error occurrence audit event
   */
  async logError(
    component: string,
    action: string,
    error: Error,
    context: Record<string, any>,
    tradeId?: string,
    positionId?: string,
    orderId?: string
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.ERROR_OCCURRED,
      tradeId,
      positionId,
      orderId,
      component,
      action,
      details: {
        errorMessage: error.message,
        errorStack: error.stack,
        context
      },
      success: false,
      errorMessage: error.message
    });
  }

  /**
   * Log recovery action audit event
   */
  async logRecoveryAction(
    component: string,
    action: string,
    recoveryDetails: Record<string, any>,
    success: boolean,
    tradeId?: string
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.RECOVERY_ACTION,
      tradeId,
      component,
      action,
      details: recoveryDetails,
      success
    });
  }

  /**
   * Log system lifecycle events
   */
  async logSystemEvent(eventType: AuditEventType.SYSTEM_START | AuditEventType.SYSTEM_STOP, details: Record<string, any>): Promise<void> {
    await this.createAuditEntry({
      eventType,
      component: 'ExecutionEngine',
      action: eventType === AuditEventType.SYSTEM_START ? 'startup' : 'shutdown',
      details,
      success: true
    });
  }

  /**
   * Log configuration changes
   */
  async logConfigurationChange(
    component: string,
    configKey: string,
    oldValue: any,
    newValue: any,
    userId?: string
  ): Promise<void> {
    await this.createAuditEntry({
      eventType: AuditEventType.CONFIGURATION_CHANGE,
      userId,
      component,
      action: 'configurationChange',
      details: {
        configKey,
        oldValue,
        newValue
      },
      beforeState: { [configKey]: oldValue },
      afterState: { [configKey]: newValue },
      success: true
    });
  }

  /**
   * Get audit trail for a specific trade
   */
  async getTradeAuditTrail(tradeId: string): Promise<AuditLogEntry[]> {
    try {
      const { data, error } = await supabase
        .from(this.AUDIT_TABLE)
        .select('*')
        .eq('trade_id', tradeId)
        .order('timestamp', { ascending: true });

      if (error) {
        logger.error('Failed to get trade audit trail', {
          tradeId,
          error: error.message
        });
        throw new Error(`Failed to get trade audit trail: ${error.message}`);
      }

      return (data || []).map(this.mapRowToAuditEntry);

    } catch (error) {
      logger.error('Error getting trade audit trail', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get audit logs by event type
   */
  async getAuditLogsByEventType(
    eventType: AuditEventType,
    timeframe?: { start: Date; end: Date },
    limit: number = 100
  ): Promise<AuditLogEntry[]> {
    try {
      let query = supabase
        .from(this.AUDIT_TABLE)
        .select('*')
        .eq('event_type', eventType)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (timeframe) {
        query = query
          .gte('timestamp', timeframe.start.toISOString())
          .lte('timestamp', timeframe.end.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to get audit logs: ${error.message}`);
      }

      return (data || []).map(this.mapRowToAuditEntry);

    } catch (error) {
      logger.error('Error getting audit logs by event type', {
        eventType,
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(timeframe: { start: Date; end: Date }): Promise<{
    totalEvents: number;
    eventsByType: Record<AuditEventType, number>;
    successRate: number;
    errorRate: number;
    mostActiveComponent: string;
  }> {
    try {
      const { data, error } = await supabase
        .from(this.AUDIT_TABLE)
        .select('event_type, component, success')
        .gte('timestamp', timeframe.start.toISOString())
        .lte('timestamp', timeframe.end.toISOString());

      if (error) {
        throw new Error(`Failed to get audit statistics: ${error.message}`);
      }

      const events = data || [];
      const totalEvents = events.length;
      
      // Count events by type
      const eventsByType: Record<string, number> = {};
      events.forEach(event => {
        eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;
      });

      // Calculate success/error rates
      const successfulEvents = events.filter(e => e.success).length;
      const successRate = totalEvents > 0 ? (successfulEvents / totalEvents) * 100 : 0;
      const errorRate = 100 - successRate;

      // Find most active component
      const componentCounts: Record<string, number> = {};
      events.forEach(event => {
        componentCounts[event.component] = (componentCounts[event.component] || 0) + 1;
      });
      
      const mostActiveComponent = Object.entries(componentCounts)
        .sort(([,a], [,b]) => b - a)[0]?.[0] || 'Unknown';

      return {
        totalEvents,
        eventsByType: eventsByType as Record<AuditEventType, number>,
        successRate: Math.round(successRate * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        mostActiveComponent
      };

    } catch (error) {
      logger.error('Error getting audit statistics', {
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async createAuditEntry(entry: Partial<AuditLogEntry>): Promise<void> {
    try {
      const auditEntry: AuditLogEntry = {
        id: this.generateAuditId(),
        timestamp: new Date(),
        success: true,
        ...entry
      } as AuditLogEntry;

      // Log to application logger
      logger.info('Audit event', {
        auditId: auditEntry.id,
        eventType: auditEntry.eventType,
        component: auditEntry.component,
        action: auditEntry.action,
        success: auditEntry.success,
        tradeId: auditEntry.tradeId,
        duration: auditEntry.duration
      });

      // Store in database (in a real implementation)
      // For now, we'll just log it since we don't have the audit table created
      // const { error } = await supabase
      //   .from(this.AUDIT_TABLE)
      //   .insert([this.mapAuditEntryToRow(auditEntry)]);

      // if (error) {
      //   logger.error('Failed to store audit entry', {
      //     auditId: auditEntry.id,
      //     error: error.message
      //   });
      // }

    } catch (error) {
      logger.error('Error creating audit entry', {
        entry,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private sanitizeSignalData(signal: TradeSignal): Record<string, any> {
    return {
      id: signal.id,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskPercent: signal.riskPercent,
      leverage: signal.leverage,
      positionSize: signal.positionSize
    };
  }

  private sanitizeValidationInput(input: any): Record<string, any> {
    return {
      accountBalance: input.accountBalance,
      riskPercent: input.riskPercent,
      leverage: input.leverage,
      positionSize: input.positionSize
    };
  }

  private sanitizeTradeData(trade: ExecutionTrade): Record<string, any> {
    return {
      id: trade.id,
      pair: trade.pair,
      side: trade.side,
      status: trade.status,
      entryPrice: trade.entryPrice,
      positionSize: trade.positionSize,
      riskPercent: trade.riskPercent,
      leverage: trade.leverage,
      executionMode: trade.executionMode
    };
  }

  private sanitizeOrderData(order: ExecutionOrder): Record<string, any> {
    return {
      id: order.id,
      side: order.side,
      requestedPrice: order.requestedPrice,
      requestedSize: order.requestedSize,
      status: order.status
    };
  }

  private sanitizePositionData(position: Position): Record<string, any> {
    return {
      id: position.id,
      side: position.side,
      size: position.size,
      avgEntryPrice: position.avgEntryPrice,
      marginUsed: position.marginUsed,
      leverage: position.leverage
    };
  }

  private sanitizeBrokerResponse(response: any): Record<string, any> {
    return {
      orderId: response.orderId,
      status: response.status,
      filledPrice: response.filledPrice,
      filledSize: response.filledSize,
      timestamp: response.timestamp
    };
  }

  private mapRowToAuditEntry(row: any): AuditLogEntry {
    return {
      id: row.id,
      eventType: row.event_type,
      timestamp: new Date(row.timestamp),
      userId: row.user_id,
      tradeId: row.trade_id,
      positionId: row.position_id,
      orderId: row.order_id,
      signalId: row.signal_id,
      component: row.component,
      action: row.action,
      details: row.details || {},
      beforeState: row.before_state,
      afterState: row.after_state,
      success: row.success,
      errorMessage: row.error_message,
      duration: row.duration,
      ipAddress: row.ip_address,
      userAgent: row.user_agent
    };
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}