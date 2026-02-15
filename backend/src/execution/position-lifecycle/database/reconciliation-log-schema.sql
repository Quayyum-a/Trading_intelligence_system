-- Reconciliation Log Database Schema
-- Table for storing broker reconciliation results and discrepancies
-- Requirements: 1.2.5

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create reconciliation_log table
CREATE TABLE IF NOT EXISTS reconciliation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reconciliation_id TEXT NOT NULL UNIQUE,
  positions_checked INTEGER NOT NULL,
  discrepancies_found INTEGER NOT NULL,
  discrepancies JSONB DEFAULT '[]'::jsonb,
  actions_taken JSONB DEFAULT '[]'::jsonb,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_created_at ON reconciliation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_reconciliation_id ON reconciliation_log(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_discrepancies_found ON reconciliation_log(discrepancies_found) WHERE discrepancies_found > 0;

-- Add comments for documentation
COMMENT ON TABLE reconciliation_log IS 'Stores results of broker reconciliation checks';
COMMENT ON COLUMN reconciliation_log.reconciliation_id IS 'Unique identifier for each reconciliation run';
COMMENT ON COLUMN reconciliation_log.positions_checked IS 'Number of positions checked during reconciliation';
COMMENT ON COLUMN reconciliation_log.discrepancies_found IS 'Number of discrepancies found';
COMMENT ON COLUMN reconciliation_log.discrepancies IS 'Array of discrepancy details (JSON)';
COMMENT ON COLUMN reconciliation_log.actions_taken IS 'Array of actions taken to resolve discrepancies (JSON)';
COMMENT ON COLUMN reconciliation_log.duration_ms IS 'Time taken to complete reconciliation in milliseconds';
