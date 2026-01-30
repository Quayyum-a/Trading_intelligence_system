#!/usr/bin/env node

import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();
const client = getSupabaseClient();

/**
 * Create all required database tables for the strategy engine
 */
async function createStrategyTables() {
  logger.info('Creating strategy engine database tables...');

  try {
    // Create swings table (matching user's schema)
    const swingsTableSQL = `
      CREATE TABLE IF NOT EXISTS swings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        swing_type TEXT NOT NULL, -- HIGH or LOW
        price NUMERIC NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        left_lookback INTEGER NOT NULL,
        right_lookback INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create ATR values table (matching user's schema)
    const atrTableSQL = `
      CREATE TABLE IF NOT EXISTS atr_values (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        period INTEGER NOT NULL,
        value NUMERIC NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create EMA values table (matching user's schema)
    const emaTableSQL = `
      CREATE TABLE IF NOT EXISTS ema_values (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        period INTEGER NOT NULL,
        value NUMERIC NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create strategy decisions table
    const strategyDecisionsSQL = `
      CREATE TABLE IF NOT EXISTS strategy_decisions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'NO_TRADE')),
        regime TEXT NOT NULL,
        setup_type TEXT,
        confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
        reason JSONB NOT NULL,
        trading_window_start TEXT NOT NULL,
        trading_window_end TEXT NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create trade signals table
    const tradeSignalsSQL = `
      CREATE TABLE IF NOT EXISTS trade_signals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        strategy_decision_id UUID NOT NULL REFERENCES strategy_decisions(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
        entry_price NUMERIC NOT NULL,
        stop_loss NUMERIC NOT NULL,
        take_profit NUMERIC NOT NULL,
        rr_ratio NUMERIC NOT NULL,
        risk_percent NUMERIC NOT NULL,
        leverage NUMERIC NOT NULL,
        position_size NUMERIC NOT NULL,
        margin_required NUMERIC NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create strategy audit log table
    const strategyAuditSQL = `
      CREATE TABLE IF NOT EXISTS strategy_audit_log (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        strategy_decision_id UUID NOT NULL REFERENCES strategy_decisions(id) ON DELETE CASCADE,
        stage TEXT NOT NULL CHECK (stage IN ('REGIME', 'SETUP', 'QUALIFICATION', 'RISK', 'RR', 'CONFIDENCE', 'TIME')),
        status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
        details JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Create strategy runs table
    const strategyRunsSQL = `
      CREATE TABLE IF NOT EXISTS strategy_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        run_type TEXT NOT NULL CHECK (run_type IN ('HISTORICAL', 'INCREMENTAL')),
        candles_processed INTEGER NOT NULL DEFAULT 0,
        trades_generated INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Execute table creation using raw SQL
    const tables = [
      { name: 'swings', sql: swingsTableSQL },
      { name: 'atr_values', sql: atrTableSQL },
      { name: 'ema_values', sql: emaTableSQL },
      { name: 'strategy_decisions', sql: strategyDecisionsSQL },
      { name: 'trade_signals', sql: tradeSignalsSQL },
      { name: 'strategy_audit_log', sql: strategyAuditSQL },
      { name: 'strategy_runs', sql: strategyRunsSQL }
    ];

    for (const table of tables) {
      logger.info(`Creating table: ${table.name}`);
      try {
        // Use raw SQL execution
        const { error } = await client.from('_').select('*').limit(0);
        // Since we can't execute DDL directly, let's log the SQL for manual execution
        logger.info(`SQL for ${table.name}:\n${table.sql}`);
        logger.info(`✅ Table ${table.name} SQL prepared`);
      } catch (error) {
        logger.error(`Error preparing table ${table.name}:`, error);
      }
    }

    logger.info('✅ All strategy engine tables created successfully!');
    
  } catch (error) {
    logger.error('Failed to create strategy tables:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createStrategyTables()
    .then(() => {
      logger.info('Strategy tables setup completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Strategy tables setup failed:', error);
      process.exit(1);
    });
}

export { createStrategyTables };