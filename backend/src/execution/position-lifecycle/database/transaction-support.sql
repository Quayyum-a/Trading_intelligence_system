-- Transaction Support RPC Function for Supabase
-- This function is required by the TransactionCoordinatorService to execute
-- raw SQL commands (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, etc.)
--
-- To deploy this function to your Supabase database:
-- 1. Go to your Supabase project dashboard
-- 2. Navigate to SQL Editor
-- 3. Run this SQL script
--
-- Security Note: This function uses SECURITY DEFINER to allow transaction
-- control. Ensure proper access controls are in place.

CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

-- Grant execute permission to authenticated users
-- Adjust this based on your security requirements
GRANT EXECUTE ON FUNCTION exec_sql(text) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION exec_sql(text) IS 
'Executes raw SQL commands for transaction control (BEGIN, COMMIT, ROLLBACK, SAVEPOINT). Required by TransactionCoordinatorService.';

-- Transaction Log Table
-- Stores metadata about all transactions for debugging and monitoring
CREATE TABLE IF NOT EXISTS transaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id VARCHAR(255) NOT NULL,
  operation_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL, -- STARTED, COMMITTED, ROLLED_BACK, FAILED
  isolation_level VARCHAR(50),
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for monitoring and querying
CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_log_transaction ON transaction_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_log_created ON transaction_log(created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE transaction_log IS 
'Audit log of all database transactions executed by TransactionCoordinatorService. Used for debugging, monitoring, and performance analysis.';
