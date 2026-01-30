-- Position Lifecycle Engine Database Schema
-- Additional tables for position lifecycle management

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create account_balances table for margin and balance tracking
CREATE TABLE IF NOT EXISTS account_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Create account_balance_events table for audit trail
CREATE TABLE IF NOT EXISTS account_balance_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Update positions table to include position lifecycle fields
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS account_id TEXT DEFAULT 'default',
ADD COLUMN IF NOT EXISTS execution_trade_id UUID,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPEN', 'CLOSED', 'LIQUIDATED', 'ARCHIVED')),
ADD COLUMN IF NOT EXISTS stop_loss NUMERIC,
ADD COLUMN IF NOT EXISTS take_profit NUMERIC,
ADD COLUMN IF NOT EXISTS close_reason TEXT CHECK (close_reason IN ('WIN', 'LOSS', 'MANUAL', 'LIQUIDATION'));

-- Create trade_executions table for position lifecycle execution tracking
CREATE TABLE IF NOT EXISTS trade_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  execution_type TEXT NOT NULL CHECK (execution_type IN ('ENTRY', 'PARTIAL_EXIT', 'FULL_EXIT', 'STOP_LOSS', 'TAKE_PROFIT', 'LIQUIDATION')),
  price NUMERIC NOT NULL,
  size NUMERIC NOT NULL,
  commission NUMERIC DEFAULT 0,
  executed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create position_events table for event sourcing
CREATE TABLE IF NOT EXISTS position_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'POSITION_CREATED',
    'ORDER_PLACED',
    'ORDER_FILLED',
    'PARTIAL_FILL',
    'POSITION_OPENED',
    'POSITION_UPDATED',
    'STOP_LOSS_TRIGGERED',
    'TAKE_PROFIT_TRIGGERED',
    'POSITION_CLOSED',
    'POSITION_LIQUIDATED'
  )),
  previous_status TEXT CHECK (previous_status IN ('PENDING', 'OPEN', 'CLOSED', 'LIQUIDATED', 'ARCHIVED')),
  new_status TEXT CHECK (new_status IN ('PENDING', 'OPEN', 'CLOSED', 'LIQUIDATED', 'ARCHIVED')),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_account_balances_account_id ON account_balances(account_id);
CREATE INDEX IF NOT EXISTS idx_account_balance_events_account_id ON account_balance_events(account_id);
CREATE INDEX IF NOT EXISTS idx_account_balance_events_created_at ON account_balance_events(created_at);
CREATE INDEX IF NOT EXISTS idx_positions_account_id ON positions(account_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_account_status ON positions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_executions_position_id ON trade_executions(position_id);
CREATE INDEX IF NOT EXISTS idx_trade_executions_execution_type ON trade_executions(execution_type);
CREATE INDEX IF NOT EXISTS idx_trade_executions_executed_at ON trade_executions(executed_at);
CREATE INDEX IF NOT EXISTS idx_position_events_position_id ON position_events(position_id);
CREATE INDEX IF NOT EXISTS idx_position_events_event_type ON position_events(event_type);
CREATE INDEX IF NOT EXISTS idx_position_events_created_at ON position_events(created_at);

-- Insert default account for testing
INSERT INTO account_balances (account_id, equity, balance, free_margin, leverage, is_paper) 
VALUES ('default', 10000, 10000, 10000, 100, true)
ON CONFLICT (account_id) DO NOTHING;

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_positions_updated_at ON positions;
CREATE TRIGGER update_positions_updated_at 
    BEFORE UPDATE ON positions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_account_balances_updated_at ON account_balances;
CREATE TRIGGER update_account_balances_updated_at 
    BEFORE UPDATE ON account_balances 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add foreign key constraints for account relationships
ALTER TABLE positions 
ADD CONSTRAINT fk_positions_account_id 
FOREIGN KEY (account_id) REFERENCES account_balances(account_id) ON DELETE CASCADE;

ALTER TABLE account_balance_events 
ADD CONSTRAINT fk_account_balance_events_account_id 
FOREIGN KEY (account_id) REFERENCES account_balances(account_id) ON DELETE CASCADE;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;