/**
 * Account Balance Repository - Database operations for account balances
 */

import { AccountBalance, AccountBalanceEvent } from '../types/position-lifecycle.types';
import { createClient } from '@supabase/supabase-js';

export class AccountBalanceRepository {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  async create(account: AccountBalance): Promise<AccountBalance> {
    const { data, error } = await this.supabase
      .from('account_balances')
      .insert({
        id: account.id,
        account_id: account.id, // Using id as account_id for consistency
        equity: account.equity,
        balance: account.balance,
        margin_used: account.marginUsed,
        free_margin: account.freeMargin,
        leverage: account.leverage,
        is_paper: account.isPaper,
        created_at: new Date(),
        updated_at: account.updatedAt
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create account balance: ${error.message}`);
    }

    return this.mapToAccountBalance(data);
  }

  async findById(accountId: string): Promise<AccountBalance | null> {
    const { data, error } = await this.supabase
      .from('account_balances')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find account balance: ${error.message}`);
    }

    return this.mapToAccountBalance(data);
  }

  async update(accountId: string, updates: Partial<AccountBalance>): Promise<AccountBalance> {
    const updateData: any = {
      updated_at: new Date()
    };

    // Map AccountBalance fields to database columns
    if (updates.equity !== undefined) updateData.equity = updates.equity;
    if (updates.balance !== undefined) updateData.balance = updates.balance;
    if (updates.marginUsed !== undefined) updateData.margin_used = updates.marginUsed;
    if (updates.freeMargin !== undefined) updateData.free_margin = updates.freeMargin;
    if (updates.leverage !== undefined) updateData.leverage = updates.leverage;
    if (updates.isPaper !== undefined) updateData.is_paper = updates.isPaper;

    const { data, error } = await this.supabase
      .from('account_balances')
      .update(updateData)
      .eq('account_id', accountId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update account balance: ${error.message}`);
    }

    return this.mapToAccountBalance(data);
  }

  async findAll(): Promise<AccountBalance[]> {
    const { data, error } = await this.supabase
      .from('account_balances')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find all account balances: ${error.message}`);
    }

    return data.map(this.mapToAccountBalance);
  }

  async findByPaperMode(isPaper: boolean): Promise<AccountBalance[]> {
    const { data, error } = await this.supabase
      .from('account_balances')
      .select('*')
      .eq('is_paper', isPaper)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find accounts by paper mode: ${error.message}`);
    }

    return data.map(this.mapToAccountBalance);
  }

  async findAccountsWithLowMargin(marginThreshold: number): Promise<AccountBalance[]> {
    const { data, error } = await this.supabase
      .from('account_balances')
      .select('*')
      .lt('free_margin', marginThreshold)
      .order('free_margin', { ascending: true });

    if (error) {
      throw new Error(`Failed to find accounts with low margin: ${error.message}`);
    }

    return data.map(this.mapToAccountBalance);
  }

  async getAccountSummary(): Promise<{
    totalAccounts: number;
    totalEquity: number;
    totalBalance: number;
    totalMarginUsed: number;
    paperAccounts: number;
    liveAccounts: number;
  }> {
    const accounts = await this.findAll();
    
    return {
      totalAccounts: accounts.length,
      totalEquity: accounts.reduce((sum, acc) => sum + acc.equity, 0),
      totalBalance: accounts.reduce((sum, acc) => sum + acc.balance, 0),
      totalMarginUsed: accounts.reduce((sum, acc) => sum + acc.marginUsed, 0),
      paperAccounts: accounts.filter(acc => acc.isPaper).length,
      liveAccounts: accounts.filter(acc => !acc.isPaper).length
    };
  }

  async delete(accountId: string): Promise<void> {
    const { error } = await this.supabase
      .from('account_balances')
      .delete()
      .eq('account_id', accountId);

    if (error) {
      throw new Error(`Failed to delete account balance: ${error.message}`);
    }
  }

  private mapToAccountBalance(data: any): AccountBalance {
    return {
      id: data.account_id,
      equity: parseFloat(data.equity),
      balance: parseFloat(data.balance),
      marginUsed: parseFloat(data.margin_used),
      freeMargin: parseFloat(data.free_margin),
      leverage: parseFloat(data.leverage),
      isPaper: data.is_paper,
      updatedAt: new Date(data.updated_at)
    };
  }
}

export class AccountBalanceEventRepository {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  async create(event: AccountBalanceEvent): Promise<AccountBalanceEvent> {
    const { data, error } = await this.supabase
      .from('account_balance_events')
      .insert({
        id: event.id,
        account_id: event.accountId,
        event_type: event.eventType,
        previous_balance: event.previousBalance,
        new_balance: event.newBalance,
        change_amount: event.change,
        reason: event.reason,
        created_at: event.createdAt
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create balance event: ${error.message}`);
    }

    return this.mapToBalanceEvent(data);
  }

  async findByAccountId(accountId: string): Promise<AccountBalanceEvent[]> {
    const { data, error } = await this.supabase
      .from('account_balance_events')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find balance events by account: ${error.message}`);
    }

    return data.map(this.mapToBalanceEvent);
  }

  async findByDateRange(
    accountId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<AccountBalanceEvent[]> {
    const { data, error } = await this.supabase
      .from('account_balance_events')
      .select('*')
      .eq('account_id', accountId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find balance events by date range: ${error.message}`);
    }

    return data.map(this.mapToBalanceEvent);
  }

  async getBalanceHistory(
    accountId: string, 
    limit: number = 100
  ): Promise<AccountBalanceEvent[]> {
    const { data, error } = await this.supabase
      .from('account_balance_events')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get balance history: ${error.message}`);
    }

    return data.map(this.mapToBalanceEvent);
  }

  private mapToBalanceEvent(data: any): AccountBalanceEvent {
    return {
      id: data.id,
      accountId: data.account_id,
      eventType: data.event_type,
      previousBalance: parseFloat(data.previous_balance),
      newBalance: parseFloat(data.new_balance),
      change: parseFloat(data.change_amount),
      reason: data.reason,
      createdAt: new Date(data.created_at)
    };
  }
}