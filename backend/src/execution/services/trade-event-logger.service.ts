/**
 * Trade Event Logger Service - Creates and persists immutable trade event records
 */

import { getSupabaseClient } from '../../config/supabase';
import { 
  ExecutionEventType, 
  ExecutionTradeEvent, 
  ExecutionTradeStatus 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface CreateTradeEventParams {
  executionTradeId: string;
  eventType: ExecutionEventType;
  previousStatus?: ExecutionTradeStatus;
  newStatus?: ExecutionTradeStatus;
  metadata?: Record<string, any>;
}

export class TradeEventLoggerService {
  /**
   * Create and persist a trade event record
   */
  async createTradeEvent(params: CreateTradeEventParams): Promise<ExecutionTradeEvent> {
    try {
      const supabase = getSupabaseClient();
      
      const eventRecord: Omit<ExecutionTradeEvent, 'id' | 'createdAt'> = {
        executionTradeId: params.executionTradeId,
        eventType: params.eventType,
        previousStatus: params.previousStatus,
        newStatus: params.newStatus,
        metadata: params.metadata || {}
      };

      const { data, error } = await supabase
        .from('execution_trade_events')
        .insert([{
          execution_trade_id: eventRecord.executionTradeId,
          event_type: eventRecord.eventType,
          previous_status: eventRecord.previousStatus,
          new_status: eventRecord.newStatus,
          metadata: eventRecord.metadata
        }])
        .select()
        .single();

      if (error) {
        logger.error('Failed to create trade event', {
          params,
          error: error.message
        });
        throw new Error(`Failed to create trade event: ${error.message}`);
      }

      const tradeEvent: ExecutionTradeEvent = {
        id: data.id,
        executionTradeId: data.execution_trade_id,
        eventType: data.event_type,
        previousStatus: data.previous_status,
        newStatus: data.new_status,
        metadata: data.metadata || {},
        createdAt: new Date(data.created_at)
      };

      logger.info('Trade event created successfully', {
        eventId: tradeEvent.id,
        tradeId: tradeEvent.executionTradeId,
        eventType: tradeEvent.eventType,
        statusTransition: tradeEvent.previousStatus ? 
          `${tradeEvent.previousStatus} -> ${tradeEvent.newStatus}` : 
          tradeEvent.newStatus
      });

      return tradeEvent;

    } catch (error) {
      logger.error('Error creating trade event', {
        params,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create a trade creation event
   */
  async logTradeCreated(executionTradeId: string, metadata?: Record<string, any>): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'CREATED',
      newStatus: 'NEW',
      metadata
    });
  }

  /**
   * Create a trade validation event
   */
  async logTradeValidated(
    executionTradeId: string, 
    validationResult: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'VALIDATED',
      previousStatus: 'NEW',
      newStatus: 'VALIDATED',
      metadata: { validationResult }
    });
  }

  /**
   * Create an order sent event
   */
  async logOrderSent(
    executionTradeId: string, 
    orderId: string, 
    orderDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'ORDER_SENT',
      previousStatus: 'VALIDATED',
      newStatus: 'ORDER_PLACED',
      metadata: { orderId, orderDetails }
    });
  }

  /**
   * Create a partial fill event
   */
  async logPartialFill(
    executionTradeId: string,
    fillDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'PARTIAL_FILL',
      previousStatus: 'ORDER_PLACED',
      newStatus: 'PARTIALLY_FILLED',
      metadata: { fillDetails }
    });
  }

  /**
   * Create a filled event
   */
  async logTradeFilled(
    executionTradeId: string,
    fillDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'FILLED',
      previousStatus: 'PARTIALLY_FILLED',
      newStatus: 'FILLED',
      metadata: { fillDetails }
    });
  }

  /**
   * Create a position opened event
   */
  async logPositionOpened(
    executionTradeId: string,
    positionId: string,
    positionDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'OPENED',
      previousStatus: 'FILLED',
      newStatus: 'OPEN',
      metadata: { positionId, positionDetails }
    });
  }

  /**
   * Create a take profit hit event
   */
  async logTakeProfitHit(
    executionTradeId: string,
    closeDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'TP_HIT',
      previousStatus: 'OPEN',
      newStatus: 'CLOSED',
      metadata: { closeReason: 'TP', closeDetails }
    });
  }

  /**
   * Create a stop loss hit event
   */
  async logStopLossHit(
    executionTradeId: string,
    closeDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'SL_HIT',
      previousStatus: 'OPEN',
      newStatus: 'CLOSED',
      metadata: { closeReason: 'SL', closeDetails }
    });
  }

  /**
   * Create a manual close event
   */
  async logManualClose(
    executionTradeId: string,
    closeDetails: Record<string, any>
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'MANUAL_CLOSE',
      previousStatus: 'OPEN',
      newStatus: 'CLOSED',
      metadata: { closeReason: 'MANUAL', closeDetails }
    });
  }

  /**
   * Create an error event
   */
  async logError(
    executionTradeId: string,
    errorDetails: Record<string, any>,
    currentStatus?: ExecutionTradeStatus
  ): Promise<ExecutionTradeEvent> {
    return this.createTradeEvent({
      executionTradeId,
      eventType: 'ERROR',
      previousStatus: currentStatus,
      metadata: { errorDetails }
    });
  }

  /**
   * Get all events for a trade
   */
  async getTradeEvents(executionTradeId: string): Promise<ExecutionTradeEvent[]> {
    try {
      const { data, error } = await supabase
        .from('execution_trade_events')
        .select('*')
        .eq('execution_trade_id', executionTradeId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to fetch trade events', {
          executionTradeId,
          error: error.message
        });
        throw new Error(`Failed to fetch trade events: ${error.message}`);
      }

      return data.map(row => ({
        id: row.id,
        executionTradeId: row.execution_trade_id,
        eventType: row.event_type,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        metadata: row.metadata || {},
        createdAt: new Date(row.created_at)
      }));

    } catch (error) {
      logger.error('Error fetching trade events', {
        executionTradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get events by type for a trade
   */
  async getTradeEventsByType(
    executionTradeId: string, 
    eventType: ExecutionEventType
  ): Promise<ExecutionTradeEvent[]> {
    try {
      const { data, error } = await supabase
        .from('execution_trade_events')
        .select('*')
        .eq('execution_trade_id', executionTradeId)
        .eq('event_type', eventType)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to fetch trade events by type', {
          executionTradeId,
          eventType,
          error: error.message
        });
        throw new Error(`Failed to fetch trade events by type: ${error.message}`);
      }

      return data.map(row => ({
        id: row.id,
        executionTradeId: row.execution_trade_id,
        eventType: row.event_type,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        metadata: row.metadata || {},
        createdAt: new Date(row.created_at)
      }));

    } catch (error) {
      logger.error('Error fetching trade events by type', {
        executionTradeId,
        eventType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check if an event type exists for a trade
   */
  async hasEventType(executionTradeId: string, eventType: ExecutionEventType): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('execution_trade_events')
        .select('id')
        .eq('execution_trade_id', executionTradeId)
        .eq('event_type', eventType)
        .limit(1);

      if (error) {
        logger.error('Failed to check event type existence', {
          executionTradeId,
          eventType,
          error: error.message
        });
        return false;
      }

      return data.length > 0;

    } catch (error) {
      logger.error('Error checking event type existence', {
        executionTradeId,
        eventType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}