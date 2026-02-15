-- Discipline Interventions Table
-- Records every time the human touches the system
-- This is the accountability layer

CREATE TABLE IF NOT EXISTS discipline_interventions (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('OVERRIDE_TRADE', 'EARLY_EXIT', 'SYSTEM_PAUSE', 'PARAMETER_CHANGE')),
  reason TEXT NOT NULL,
  account_balance_before DECIMAL(15, 2) NOT NULL,
  account_balance_after DECIMAL(15, 2),
  opportunity_cost DECIMAL(15, 2),
  emotional_state TEXT NOT NULL,
  regret_score INTEGER CHECK (regret_score >= 0 AND regret_score <= 10),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by timestamp
CREATE INDEX IF NOT EXISTS idx_discipline_interventions_timestamp 
ON discipline_interventions(timestamp DESC);

-- Index for querying by type
CREATE INDEX IF NOT EXISTS idx_discipline_interventions_type 
ON discipline_interventions(type);

-- Shadow Positions Table
-- Tracks what would have happened if you didn't intervene
CREATE TABLE IF NOT EXISTS shadow_positions (
  id TEXT PRIMARY KEY,
  intervention_id TEXT NOT NULL REFERENCES discipline_interventions(id),
  original_position_id TEXT NOT NULL,
  exit_pnl DECIMAL(15, 2) NOT NULL,
  actual_pnl DECIMAL(15, 2),
  opportunity_cost DECIMAL(15, 2),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying shadow positions by intervention
CREATE INDEX IF NOT EXISTS idx_shadow_positions_intervention 
ON shadow_positions(intervention_id);

-- Discipline Metrics View
-- Aggregated metrics for reporting
CREATE OR REPLACE VIEW discipline_metrics AS
SELECT
  COUNT(*) as total_interventions,
  SUM(opportunity_cost) as total_opportunity_cost,
  AVG(regret_score) as avg_regret_score,
  MAX(timestamp) as last_intervention,
  EXTRACT(DAY FROM NOW() - MAX(timestamp)) as days_since_last,
  COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '7 days') as interventions_last_7_days,
  COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '30 days') as interventions_last_30_days,
  COUNT(*) FILTER (WHERE type = 'OVERRIDE_TRADE') as override_count,
  COUNT(*) FILTER (WHERE type = 'EARLY_EXIT') as early_exit_count,
  COUNT(*) FILTER (WHERE type = 'SYSTEM_PAUSE') as pause_count,
  COUNT(*) FILTER (WHERE type = 'PARAMETER_CHANGE') as parameter_change_count
FROM discipline_interventions;

-- Function to calculate intervention-free streak
CREATE OR REPLACE FUNCTION calculate_discipline_streak()
RETURNS INTEGER AS $$
DECLARE
  last_intervention TIMESTAMPTZ;
  days_since INTEGER;
BEGIN
  SELECT MAX(timestamp) INTO last_intervention
  FROM discipline_interventions;
  
  IF last_intervention IS NULL THEN
    RETURN 999; -- No interventions ever
  END IF;
  
  days_since := EXTRACT(DAY FROM NOW() - last_intervention);
  RETURN days_since;
END;
$$ LANGUAGE plpgsql;

-- Function to update opportunity cost when shadow position closes
CREATE OR REPLACE FUNCTION update_intervention_opportunity_cost()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the intervention record with the opportunity cost
  UPDATE discipline_interventions
  SET 
    opportunity_cost = NEW.opportunity_cost,
    updated_at = NOW()
  WHERE id = NEW.intervention_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update opportunity cost
CREATE TRIGGER trigger_update_opportunity_cost
AFTER UPDATE ON shadow_positions
FOR EACH ROW
WHEN (NEW.opportunity_cost IS NOT NULL AND OLD.opportunity_cost IS NULL)
EXECUTE FUNCTION update_intervention_opportunity_cost();

-- Comments for documentation
COMMENT ON TABLE discipline_interventions IS 'Records every human intervention in the automated system. Used to track emotional trading and calculate opportunity cost.';
COMMENT ON TABLE shadow_positions IS 'Tracks what would have happened if the trader did not intervene. Used to calculate the true cost of emotional decisions.';
COMMENT ON VIEW discipline_metrics IS 'Aggregated discipline metrics for daily reporting and accountability.';
