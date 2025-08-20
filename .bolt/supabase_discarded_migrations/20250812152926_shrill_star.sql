/*
  # Prevent Duplicate FP Earnings

  1. Index Creation
    - Create unique functional index on fp_earnings to prevent duplicates
    - Uses DATE(earned_at) to group by date without needing new column

  2. Function Updates
    - Update complete_boost to only insert into completed_boosts
    - Let existing triggers handle FP awards to avoid race conditions

  3. Trigger Enhancement
    - Add ON CONFLICT DO NOTHING to prevent duplicate errors
    - Maintain existing functionality while preventing duplicates
*/

-- Create unique functional index to prevent duplicate FP earnings
-- This prevents the same user from earning FP for the same boost on the same day
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_earnings_unique_boost_daily
ON fp_earnings (user_id, item_id, item_type, DATE(earned_at))
WHERE item_type = 'boost';

-- Update complete_boost function to only insert into completed_boosts
-- Let the trigger handle FP awards to avoid race conditions
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_boost_fp INTEGER;
  v_boost_name TEXT;
  v_today DATE := CURRENT_DATE;
  v_result JSONB;
BEGIN
  -- Check if boost was already completed today
  IF EXISTS (
    SELECT 1 FROM completed_boosts 
    WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;

  -- Get boost details
  SELECT fp_value, 'Boost: ' || p_boost_id
  INTO v_boost_fp, v_boost_name
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;

  -- Use default if not found
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10;
    v_boost_name := 'Daily Boost: ' || p_boost_id;
  END IF;

  -- Insert into completed_boosts only
  -- The trigger will handle FP award
  INSERT INTO completed_boosts (
    user_id,
    boost_id,
    completed_at,
    completed_date,
    boost_name
  ) VALUES (
    p_user_id,
    p_boost_id,
    NOW(),
    v_today,
    v_boost_name
  );

  -- Return expected FP (actual award handled by trigger)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_boost_fp,
    'boost_name', v_boost_name
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the sync_boost_fp_earning trigger function to handle duplicates gracefully
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER AS $$
DECLARE
  v_boost_fp INTEGER;
  v_boost_name TEXT;
  v_user_name TEXT;
BEGIN
  -- Get boost FP value
  SELECT fp_value INTO v_boost_fp
  FROM boost_fp_values 
  WHERE boost_id = NEW.boost_id;
  
  -- Use default if not found
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10;
  END IF;

  -- Get user name
  SELECT name INTO v_user_name
  FROM users 
  WHERE id = NEW.user_id;

  -- Get boost name
  v_boost_name := COALESCE(NEW.boost_name, 'Daily Boost: ' || NEW.boost_id);

  -- Insert FP earning with duplicate protection
  INSERT INTO fp_earnings (
    user_id,
    item_id,
    item_name,
    item_type,
    fp_amount,
    earned_at,
    user_name,
    title,
    description
  ) VALUES (
    NEW.user_id,
    NEW.boost_id,
    v_boost_name,
    'boost',
    v_boost_fp,
    NEW.completed_at,
    v_user_name,
    v_boost_name,
    'Completed daily boost: ' || NEW.boost_id
  )
  ON CONFLICT ON CONSTRAINT idx_fp_earnings_unique_boost_daily DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;