-- Supabase-Compatible Transaction Support
-- This approach uses PostgreSQL stored procedures that are automatically
-- wrapped in transactions by Supabase, providing true ACID guarantees.

-- ============================================================================
-- TRANSACTION LOG TABLE
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_transaction_log_status ON transaction_log(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_log_transaction ON transaction_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_log_created ON transaction_log(created_at DESC);

COMMENT ON TABLE transaction_log IS 
'Audit log of all database transactions. Used for debugging, monitoring, and performance analysis.';

-- ============================================================================
-- HELPER FUNCTION: Log Transaction
-- ============================================================================

CREATE OR REPLACE FUNCTION log_transaction(
  p_transaction_id VARCHAR(255),
  p_operation_name VARCHAR(255),
  p_status VARCHAR(20),
  p_started_at TIMESTAMP,
  p_error_message TEXT,
  p_metadata JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
  v_duration_ms INTEGER;
BEGIN
  v_duration_ms := EXTRACT(EPOCH FROM (NOW() - p_started_at)) * 1000;
  
  INSERT INTO transaction_log (
    transaction_id,
    operation_name,
    status,
    started_at,
    completed_at,
    duration_ms,
    error_message,
    metadata
  ) VALUES (
    p_transaction_id,
    p_operation_name,
    p_status,
    p_started_at,
    NOW(),
    v_duration_ms,
    p_error_message,
    p_metadata
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_transaction TO authenticated, service_role;

-- ============================================================================
-- ATOMIC OPERATION: Close Position
-- ============================================================================

CREATE OR REPLACE FUNCTION atomic_close_position(
  p_position_id UUID,
  p_close_price DECIMAL,
  p_close_reason VARCHAR(50),
  p_transaction_id VARCHAR(255)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position RECORD;
  v_pnl DECIMAL;
  v_started_at TIMESTAMP;
  v_result JSONB;
BEGIN
  v_started_at := NOW();
  
  -- Lock the position row for update
  SELECT * INTO v_position
  FROM positions
  WHERE id = p_position_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    PERFORM log_transaction(
      p_transaction_id,
      'close_position',
      'FAILED',
      v_started_at,
      'Position not found: ' || p_position_id::TEXT,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Position not found: %', p_position_id;
  END IF;
  
  IF v_position.status = 'CLOSED' THEN
    PERFORM log_transaction(
      p_transaction_id,
      'close_position',
      'FAILED',
      v_started_at,
      'Position already closed: ' || p_position_id::TEXT,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Position already closed: %', p_position_id;
  END IF;
  
  -- Calculate P&L
  IF v_position.side = 'LONG' THEN
    v_pnl := (p_close_price - v_position.entry_price) * v_position.quantity;
  ELSE
    v_pnl := (v_position.entry_price - p_close_price) * v_position.quantity;
  END IF;
  
  -- Update position
  UPDATE positions
  SET 
    status = 'CLOSED',
    exit_price = p_close_price,
    exit_time = NOW(),
    realized_pnl = v_pnl,
    close_reason = p_close_reason,
    updated_at = NOW()
  WHERE id = p_position_id;
  
  -- Create balance event
  INSERT INTO account_balance_events (
    account_id,
    event_type,
    amount,
    balance_after,
    related_position_id,
    metadata
  )
  SELECT
    v_position.account_id,
    'POSITION_CLOSED',
    v_pnl,
    (SELECT balance FROM accounts WHERE id = v_position.account_id) + v_pnl,
    p_position_id,
    jsonb_build_object(
      'position_id', p_position_id,
      'pnl', v_pnl,
      'close_price', p_close_price,
      'close_reason', p_close_reason
    );
  
  -- Update account balance
  UPDATE accounts
  SET 
    balance = balance + v_pnl,
    updated_at = NOW()
  WHERE id = v_position.account_id;
  
  -- Release margin
  UPDATE accounts
  SET 
    margin_used = margin_used - v_position.margin_required,
    updated_at = NOW()
  WHERE id = v_position.account_id;
  
  -- Log success
  PERFORM log_transaction(
    p_transaction_id,
    'close_position',
    'COMMITTED',
    v_started_at,
    '',
    jsonb_build_object(
      'position_id', p_position_id,
      'pnl', v_pnl,
      'close_price', p_close_price
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'pnl', v_pnl,
    'close_price', p_close_price
  );
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  -- Log failure
  PERFORM log_transaction(
    p_transaction_id,
    'close_position',
    'ROLLED_BACK',
    v_started_at,
    SQLERRM,
    '{}'::jsonb
  );
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_close_position TO authenticated, service_role;

-- ============================================================================
-- ATOMIC OPERATION: Update Stop Loss / Take Profit
-- ============================================================================

CREATE OR REPLACE FUNCTION atomic_update_sltp(
  p_position_id UUID,
  p_transaction_id VARCHAR(255),
  p_stop_loss DECIMAL,
  p_take_profit DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position RECORD;
  v_started_at TIMESTAMP;
  v_result JSONB;
BEGIN
  v_started_at := NOW();
  
  -- Lock the position row for update
  SELECT * INTO v_position
  FROM positions
  WHERE id = p_position_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    PERFORM log_transaction(
      p_transaction_id,
      'update_sltp',
      'FAILED',
      v_started_at,
      'Position not found: ' || p_position_id::TEXT,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Position not found: %', p_position_id;
  END IF;
  
  IF v_position.status != 'OPEN' THEN
    PERFORM log_transaction(
      p_transaction_id,
      'update_sltp',
      'FAILED',
      v_started_at,
      'Position not open: ' || p_position_id::TEXT,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Position not open: %', p_position_id;
  END IF;
  
  -- Update position (only update if value is provided, otherwise keep existing)
  UPDATE positions
  SET 
    stop_loss = CASE WHEN p_stop_loss IS NOT NULL THEN p_stop_loss ELSE stop_loss END,
    take_profit = CASE WHEN p_take_profit IS NOT NULL THEN p_take_profit ELSE take_profit END,
    updated_at = NOW()
  WHERE id = p_position_id;
  
  -- Log success
  PERFORM log_transaction(
    p_transaction_id,
    'update_sltp',
    'COMMITTED',
    v_started_at,
    '',
    jsonb_build_object(
      'position_id', p_position_id,
      'stop_loss', p_stop_loss,
      'take_profit', p_take_profit
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'stop_loss', p_stop_loss,
    'take_profit', p_take_profit
  );
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  PERFORM log_transaction(
    p_transaction_id,
    'update_sltp',
    'ROLLED_BACK',
    v_started_at,
    SQLERRM,
    '{}'::jsonb
  );
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_update_sltp TO authenticated, service_role;

-- ============================================================================
-- ATOMIC OPERATION: Open Position
-- ============================================================================

CREATE OR REPLACE FUNCTION atomic_open_position(
  p_account_id UUID,
  p_symbol VARCHAR(20),
  p_side VARCHAR(10),
  p_quantity DECIMAL,
  p_entry_price DECIMAL,
  p_margin_required DECIMAL,
  p_transaction_id VARCHAR(255),
  p_stop_loss DECIMAL,
  p_take_profit DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account RECORD;
  v_position_id UUID;
  v_started_at TIMESTAMP;
  v_result JSONB;
BEGIN
  v_started_at := NOW();
  
  -- Lock the account row for update
  SELECT * INTO v_account
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    PERFORM log_transaction(
      p_transaction_id,
      'open_position',
      'FAILED',
      v_started_at,
      'Account not found: ' || p_account_id::TEXT,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Account not found: %', p_account_id;
  END IF;
  
  -- Check margin availability
  IF (v_account.balance - v_account.margin_used) < p_margin_required THEN
    PERFORM log_transaction(
      p_transaction_id,
      'open_position',
      'FAILED',
      v_started_at,
      'Insufficient margin',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Insufficient margin';
  END IF;
  
  -- Create position
  INSERT INTO positions (
    account_id,
    symbol,
    side,
    quantity,
    entry_price,
    entry_time,
    stop_loss,
    take_profit,
    margin_required,
    status
  ) VALUES (
    p_account_id,
    p_symbol,
    p_side,
    p_quantity,
    p_entry_price,
    NOW(),
    p_stop_loss,
    p_take_profit,
    p_margin_required,
    'OPEN'
  )
  RETURNING id INTO v_position_id;
  
  -- Reserve margin
  UPDATE accounts
  SET 
    margin_used = margin_used + p_margin_required,
    updated_at = NOW()
  WHERE id = p_account_id;
  
  -- Create balance event
  INSERT INTO account_balance_events (
    account_id,
    event_type,
    amount,
    balance_after,
    related_position_id,
    metadata
  ) VALUES (
    p_account_id,
    'POSITION_OPENED',
    -p_margin_required,
    v_account.balance,
    v_position_id,
    jsonb_build_object(
      'position_id', v_position_id,
      'margin_required', p_margin_required
    )
  );
  
  -- Log success
  PERFORM log_transaction(
    p_transaction_id,
    'open_position',
    'COMMITTED',
    v_started_at,
    '',
    jsonb_build_object(
      'position_id', v_position_id,
      'symbol', p_symbol,
      'side', p_side,
      'quantity', p_quantity
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'position_id', v_position_id
  );
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  PERFORM log_transaction(
    p_transaction_id,
    'open_position',
    'ROLLED_BACK',
    v_started_at,
    SQLERRM,
    '{}'::jsonb
  );
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_open_position TO authenticated, service_role;

-- ============================================================================
-- DEPLOYMENT INSTRUCTIONS
-- ============================================================================

COMMENT ON FUNCTION atomic_close_position IS 
'Atomically closes a position with full ACID guarantees. Updates position, account balance, and margin in a single transaction.';

COMMENT ON FUNCTION atomic_update_sltp IS 
'Atomically updates stop loss and take profit levels for an open position.';

COMMENT ON FUNCTION atomic_open_position IS 
'Atomically opens a new position with margin reservation and balance tracking.';
