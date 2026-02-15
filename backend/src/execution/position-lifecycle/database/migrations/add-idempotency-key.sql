-- Migration: Add idempotency_key to position_events table
-- Purpose: Enable idempotent position closure to prevent double-close scenarios
-- Requirements: 1.3.1, 1.3.2

-- Add idempotency_key column to position_events table
ALTER TABLE position_events 
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE;

-- Create index for fast idempotency key lookups
CREATE INDEX IF NOT EXISTS idx_position_events_idempotency 
ON position_events(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN position_events.idempotency_key IS 
'Unique key for idempotent operations. Format: close_${positionId}_${timestamp}';
