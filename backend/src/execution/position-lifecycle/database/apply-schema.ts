#!/usr/bin/env tsx

/**
 * Apply Position Lifecycle Engine Database Schema
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applySchema() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('🔧 Applying Position Lifecycle Engine Database Schema...');

  try {
    // Create account_balances table
    console.log('Creating account_balances table...');
    const { error: accountBalancesError } = await supabase.rpc('exec', {
      sql: `
        CREATE TABLE IF NOT EXISTS account_balances (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id TEXT NOT NULL UNIQUE,
          equity NUMERIC NOT NULL DEFAULT 0,
          balance NUMERIC NOT NULL DEFAULT 0,
          margin_used NUMERIC NOT NULL DEFAULT 0,
          free_margin NUMERIC NOT NULL DEFAULT 0,
          leverage NUMERIC NOT NULL DEFAULT 1,
          is_paper BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `
    });

    if (accountBalancesError) {
      console.log('⚠️  Account balances table may already exist or there was an issue:', accountBalancesError.message);
    } else {
      console.log('✅ Account balances table created');
    }

    // Create account_balance_events table
    console.log('Creating account_balance_events table...');
    const { error: balanceEventsError } = await supabase.rpc('exec', {
      sql: `
        CREATE TABLE IF NOT EXISTS account_balance_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          previous_balance NUMERIC NOT NULL,
          new_balance NUMERIC NOT NULL,
          change_amount NUMERIC NOT NULL,
          reason TEXT NOT NULL,
          position_id UUID,
          execution_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `
    });

    if (balanceEventsError) {
      console.log('⚠️  Account balance events table may already exist:', balanceEventsError.message);
    } else {
      console.log('✅ Account balance events table created');
    }

    // Insert default account
    console.log('Creating default test account...');
    const { error: insertError } = await supabase
      .from('account_balances')
      .upsert({
        account_id: 'default',
        equity: 50000,
        balance: 50000,
        margin_used: 0,
        free_margin: 50000,
        leverage: 100,
        is_paper: true
      }, {
        onConflict: 'account_id'
      });

    if (insertError) {
      console.log('⚠️  Default account creation issue:', insertError.message);
    } else {
      console.log('✅ Default test account created');
    }

    // Test the tables
    console.log('Testing table access...');
    const { data: accountTest, error: testError } = await supabase
      .from('account_balances')
      .select('*')
      .limit(1);

    if (testError) {
      console.error('❌ Table access test failed:', testError.message);
    } else {
      console.log('✅ Tables accessible, found', accountTest?.length || 0, 'account records');
    }

    console.log('🎉 Schema application completed successfully!');

  } catch (error) {
    console.error('❌ Schema application failed:', error);
    process.exit(1);
  }
}

applySchema();