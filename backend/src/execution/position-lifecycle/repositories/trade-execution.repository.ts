/**
 * Trade Execution Repository - Database operations for trade executions
 */

import { TradeExecution, ExecutionType } from '../types/position-lifecycle.types';
import { createClient } from '@supabase/supabase-js';

export class TradeExecutionRepository {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  async create(execution: TradeExecution): Promise<TradeExecution> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .insert({
        id: execution.id,
        position_id: execution.positionId,
        order_id: execution.orderId,
        execution_type: execution.executionType,
        price: execution.price,
        size: execution.size,
        executed_at: execution.executedAt,
        created_at: execution.createdAt
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create trade execution: ${error.message}`);
    }

    return this.mapToTradeExecution(data);
  }

  async findById(id: string): Promise<TradeExecution | null> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find trade execution: ${error.message}`);
    }

    return this.mapToTradeExecution(data);
  }

  async findByPositionId(positionId: string): Promise<TradeExecution[]> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .eq('position_id', positionId)
      .order('executed_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find executions by position: ${error.message}`);
    }

    return data.map(this.mapToTradeExecution);
  }

  async findByExecutionType(executionType: ExecutionType): Promise<TradeExecution[]> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .eq('execution_type', executionType)
      .order('executed_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find executions by type: ${error.message}`);
    }

    return data.map(this.mapToTradeExecution);
  }

  async findByOrderId(orderId: string): Promise<TradeExecution[]> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .eq('order_id', orderId)
      .order('executed_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find executions by order: ${error.message}`);
    }

    return data.map(this.mapToTradeExecution);
  }

  async findAll(): Promise<TradeExecution[]> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .order('executed_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find all executions: ${error.message}`);
    }

    return data.map(this.mapToTradeExecution);
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<TradeExecution[]> {
    const { data, error } = await this.supabase
      .from('trade_executions')
      .select('*')
      .gte('executed_at', startDate.toISOString())
      .lte('executed_at', endDate.toISOString())
      .order('executed_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find executions by date range: ${error.message}`);
    }

    return data.map(this.mapToTradeExecution);
  }

  async getExecutionStats(positionId: string): Promise<{
    totalExecutions: number;
    entryExecutions: number;
    exitExecutions: number;
    totalVolume: number;
    averagePrice: number;
  }> {
    const executions = await this.findByPositionId(positionId);
    
    const entryExecutions = executions.filter(e => e.executionType === ExecutionType.ENTRY);
    const exitExecutions = executions.filter(e => 
      [ExecutionType.PARTIAL_EXIT, ExecutionType.FULL_EXIT, ExecutionType.STOP_LOSS, ExecutionType.TAKE_PROFIT, ExecutionType.LIQUIDATION]
      .includes(e.executionType)
    );

    const totalVolume = executions.reduce((sum, e) => sum + e.size, 0);
    const weightedPriceSum = executions.reduce((sum, e) => sum + (e.price * e.size), 0);
    const averagePrice = totalVolume > 0 ? weightedPriceSum / totalVolume : 0;

    return {
      totalExecutions: executions.length,
      entryExecutions: entryExecutions.length,
      exitExecutions: exitExecutions.length,
      totalVolume,
      averagePrice
    };
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('trade_executions')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete trade execution: ${error.message}`);
    }
  }

  private mapToTradeExecution(data: any): TradeExecution {
    return {
      id: data.id,
      positionId: data.position_id,
      orderId: data.order_id,
      executionType: data.execution_type as ExecutionType,
      price: parseFloat(data.price),
      size: parseFloat(data.size),
      executedAt: new Date(data.executed_at),
      createdAt: new Date(data.created_at)
    };
  }
}