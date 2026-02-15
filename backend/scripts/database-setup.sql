-- Database Setup Script for Trading Backend
-- Run this script in your Supabase SQL editor to create all required tables

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create candles table (base table for all other tables)
CREATE TABLE IF NOT EXISTS candles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pair, timeframe, timestamp)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_candles_pair_timeframe_timestamp ON candles(pair, timeframe, timestamp);

-- Create swings table
CREATE TABLE IF NOT EXISTS swings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  swing_type TEXT NOT NULL CHECK (swing_type IN ('HIGH', 'LOW')),
  price NUMERIC NOT NULL,
  candle_timestamp TIMESTAMPTZ NOT NULL,
  left_lookback INTEGER NOT NULL,
  right_lookback INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create ATR values table
CREATE TABLE IF NOT EXISTS atr_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  period INTEGER NOT NULL,
  value NUMERIC NOT NULL,
  candle_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(candle_id, period)
);

-- Create EMA values table
CREATE TABLE IF NOT EXISTS ema_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candle_id UUID NOT NULL REFERENCES candles(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  period INTEGER NOT NULL,
  value NUMERIC NOT NULL,
  candle_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(candle_id, period)
);

-- Create strategy decisions table
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

-- Create trade signals table
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

-- Create execution trades table
CREATE TABLE IF NOT EXISTS execution_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_signal_id UUID NOT NULL REFERENCES trade_signals(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  status TEXT NOT NULL CHECK (status IN ('NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN', 'CLOSED')),
  entry_price NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit NUMERIC NOT NULL,
  position_size NUMERIC NOT NULL,
  risk_percent NUMERIC NOT NULL,
  leverage NUMERIC NOT NULL,
  rr NUMERIC NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('PAPER', 'MT5', 'REST')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK (close_reason IN ('TP', 'SL', 'MANUAL', 'ERROR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create execution_orders table
CREATE TABLE IF NOT EXISTS execution_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_trade_id UUID NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  broker_order_id TEXT,
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  size NUMERIC NOT NULL,
  price NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED')),
  filled_size NUMERIC DEFAULT 0,
  filled_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_trade_id UUID NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  size NUMERIC NOT NULL,
  avg_entry_price NUMERIC NOT NULL,
  leverage NUMERIC NOT NULL,
  margin_used NUMERIC NOT NULL,
  unrealized_pnl NUMERIC DEFAULT 0,
  realized_pnl NUMERIC DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create executions table
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_order_id UUID NOT NULL REFERENCES execution_orders(id) ON DELETE CASCADE,
  execution_trade_id UUID NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  filled_size NUMERIC NOT NULL,
  filled_price NUMERIC NOT NULL,
  commission NUMERIC DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create execution_trade_events table
CREATE TABLE IF NOT EXISTS execution_trade_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_trade_id UUID NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create strategy audit log table
CREATE TABLE IF NOT EXISTS strategy_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy_decision_id UUID NOT NULL REFERENCES strategy_decisions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('REGIME', 'SETUP', 'QUALIFICATION', 'RISK', 'RR', 'CONFIDENCE', 'TIME')),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create strategy runs table
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_atr_values_candle_period ON atr_values(candle_id, period);
CREATE INDEX IF NOT EXISTS idx_ema_values_candle_period ON ema_values(candle_id, period);
CREATE INDEX IF NOT EXISTS idx_swings_candle ON swings(candle_id);
CREATE INDEX IF NOT EXISTS idx_strategy_decisions_candle ON strategy_decisions(candle_id);
CREATE INDEX IF NOT EXISTS idx_trade_signals_decision ON trade_signals(strategy_decision_id);
CREATE INDEX IF NOT EXISTS idx_execution_trades_signal ON execution_trades(trade_signal_id);
CREATE INDEX IF NOT EXISTS idx_execution_orders_trade ON execution_orders(execution_trade_id);
CREATE INDEX IF NOT EXISTS idx_positions_trade ON positions(execution_trade_id);
CREATE INDEX IF NOT EXISTS idx_executions_order ON executions(execution_order_id);
CREATE INDEX IF NOT EXISTS idx_execution_trade_events_trade ON execution_trade_events(execution_trade_id);

-- Insert some test data to help with tests
INSERT INTO candles (id, pair, timeframe, timestamp, open, high, low, close, volume) VALUES
  ('00000000-0000-0000-0000-000000000001', 'XAUUSD', 'M15', '2024-01-01 00:00:00+00', 2000, 2005, 1995, 2002, 100),
  ('00000000-0000-0000-0000-000000000002', 'XAUUSD', 'M15', '2024-01-01 00:15:00+00', 2002, 2008, 1998, 2005, 120),
  ('00000000-0000-0000-0000-000000000003', 'XAUUSD', 'M15', '2024-01-01 00:30:00+00', 2005, 2010, 2000, 2007, 110)
ON CONFLICT (pair, timeframe, timestamp) DO NOTHING;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;