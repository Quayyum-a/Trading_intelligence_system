/**
 * Position Event Repository - Database operations for position events
 */

import { PositionEvent, PositionEventType, PositionState } from '../types/position-lifecycle.types';
import { createClient } from '@supabase/supabase-js';

export class PositionEventRepository {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  async create(event: PositionEvent): Promise<PositionEvent> {
    const { data, error } = await this.supabase
      .from('position_events')
      .insert({
        id: event.id,
        position_id: event.positionId,
        event_type: event.eventType,
        previous_status: event.previousStatus,
        new_status: event.newStatus,
        payload: event.payload,
        created_at: event.createdAt
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create position event: ${error.message}`);
    }

    return this.mapToPositionEvent(data);
  }

  async findById(id: string): Promise<PositionEvent | null> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find position event: ${error.message}`);
    }

    return this.mapToPositionEvent(data);
  }

  async findByPositionId(
    positionId: string, 
    options?: {
      orderBy?: 'created_at';
      direction?: 'ASC' | 'DESC';
      limit?: number;
    }
  ): Promise<PositionEvent[]> {
    let query = this.supabase
      .from('position_events')
      .select('*')
      .eq('position_id', positionId);

    if (options?.orderBy) {
      query = query.order(options.orderBy, { 
        ascending: options.direction === 'ASC' 
      });
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to find events by position: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async findByPositionIdAndType(
    positionId: string, 
    eventType: PositionEventType
  ): Promise<PositionEvent[]> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .eq('position_id', positionId)
      .eq('event_type', eventType)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find events by position and type: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async findByEventType(eventType: PositionEventType): Promise<PositionEvent[]> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .eq('event_type', eventType)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find events by type: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<PositionEvent[]> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find events by date range: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async findAll(): Promise<PositionEvent[]> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find all events: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async getEventCount(positionId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('position_events')
      .select('*', { count: 'exact', head: true })
      .eq('position_id', positionId);

    if (error) {
      throw new Error(`Failed to get event count: ${error.message}`);
    }

    return count || 0;
  }

  async getEventsByStateTransition(
    fromState: PositionState, 
    toState: PositionState
  ): Promise<PositionEvent[]> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .eq('previous_status', fromState)
      .eq('new_status', toState)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find events by state transition: ${error.message}`);
    }

    return data.map(this.mapToPositionEvent);
  }

  async getLatestEventByPosition(positionId: string): Promise<PositionEvent | null> {
    const { data, error } = await this.supabase
      .from('position_events')
      .select('*')
      .eq('position_id', positionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find latest event: ${error.message}`);
    }

    return this.mapToPositionEvent(data);
  }

  async getEventStatistics(): Promise<{
    totalEvents: number;
    eventsByType: Record<PositionEventType, number>;
    eventsLast24Hours: number;
  }> {
    // Get total count
    const { count: totalEvents, error: countError } = await this.supabase
      .from('position_events')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Failed to get total event count: ${countError.message}`);
    }

    // Get events by type
    const { data: typeData, error: typeError } = await this.supabase
      .from('position_events')
      .select('event_type')
      .order('event_type');

    if (typeError) {
      throw new Error(`Failed to get events by type: ${typeError.message}`);
    }

    const eventsByType: Record<string, number> = {};
    typeData.forEach(event => {
      eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;
    });

    // Get events in last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { count: eventsLast24Hours, error: recentError } = await this.supabase
      .from('position_events')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString());

    if (recentError) {
      throw new Error(`Failed to get recent event count: ${recentError.message}`);
    }

    return {
      totalEvents: totalEvents || 0,
      eventsByType: eventsByType as Record<PositionEventType, number>,
      eventsLast24Hours: eventsLast24Hours || 0
    };
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('position_events')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete position event: ${error.message}`);
    }
  }

  async deleteByPositionId(positionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('position_events')
      .delete()
      .eq('position_id', positionId);

    if (error) {
      throw new Error(`Failed to delete events by position: ${error.message}`);
    }
  }

  private mapToPositionEvent(data: any): PositionEvent {
    return {
      id: data.id,
      positionId: data.position_id,
      eventType: data.event_type as PositionEventType,
      previousStatus: data.previous_status as PositionState | undefined,
      newStatus: data.new_status as PositionState | undefined,
      payload: data.payload || {},
      createdAt: new Date(data.created_at)
    };
  }
}