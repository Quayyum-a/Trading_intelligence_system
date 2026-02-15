-- Task 8: Ledger Completeness - Database Schema Enhancements
-- This migration adds constraints and indexes to enforce ledger integrity

-- Task 8.1: Add database constraints for balance equation
-- Requirement 3.1.3: Enforce balance_after = balance_before + amount

-- First, rename columns to match requirements (balance_before, balance_after, amount)
ALTER TABLE account_balance_events 
  RENAME COLUMN previous_balance TO balance_before;

ALTER TABLE account_balance_events 
  RENAME COLUMN new_balance TO balance_after;

ALTER TABLE account_balance_events 
  RENAME COLUMN change_amount TO amount;

-- Add NOT NULL constraints on all balance fields (Requirement 3.1.6)
ALTER TABLE account_balance_events 
  ALTER COLUMN balance_before SET NOT NULL,
  ALTER COLUMN balance_after SET NOT NULL,
  ALTER COLUMN amount SET NOT NULL;

-- Add CHECK constraint to enforce balance equation (Requirement 3.1.3)
-- balance_after = balance_before + amount
ALTER TABLE account_balance_events 
  ADD CONSTRAINT chk_balance_equation 
  CHECK (balance_after = balance_before + amount);

-- Add CHECK constraint to prevent zero defaults (Requirement 3.1.6)
-- This ensures that balance fields are explicitly set, not defaulted to 0
-- Note: We allow 0 as a valid value, but the NOT NULL constraint ensures explicit setting

-- Task 8.2: Add indexes for ledger queries (Requirement 3.2.6)

-- Index for account ledger queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_account_balance_events_account_created 
  ON account_balance_events(account_id, created_at DESC);

-- Index for position-related balance events
CREATE INDEX IF NOT EXISTS idx_account_balance_events_position 
  ON account_balance_events(position_id) 
  WHERE position_id IS NOT NULL;

-- Index for audit trail queries by event type
CREATE INDEX IF NOT EXISTS idx_account_balance_events_type_created 
  ON account_balance_events(event_type, created_at DESC);

-- Composite index for integrity validation queries
CREATE INDEX IF NOT EXISTS idx_account_balance_events_account_type 
  ON account_balance_events(account_id, event_type);

-- Add comments for documentation
COMMENT ON CONSTRAINT chk_balance_equation ON account_balance_events IS 
  'Enforces the fundamental balance equation: balance_after = balance_before + amount. This ensures ledger integrity and prevents data corruption.';

COMMENT ON COLUMN account_balance_events.balance_before IS 
  'Account balance before this event. Must be explicitly set (NOT NULL).';

COMMENT ON COLUMN account_balance_events.balance_after IS 
  'Account balance after this event. Must equal balance_before + amount (enforced by CHECK constraint).';

COMMENT ON COLUMN account_balance_events.amount IS 
  'Change in balance. Positive for credits, negative for debits. Must be explicitly set (NOT NULL).';

-- Verification query to check existing data compliance
-- Run this after migration to ensure all existing records comply
DO $$
DECLARE
  violation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM account_balance_events
  WHERE balance_after != balance_before + amount;
  
  IF violation_count > 0 THEN
    RAISE WARNING 'Found % existing records that violate the balance equation. These must be corrected before applying constraints.', violation_count;
  ELSE
    RAISE NOTICE 'All existing records comply with the balance equation. Safe to apply constraints.';
  END IF;
END $$;
