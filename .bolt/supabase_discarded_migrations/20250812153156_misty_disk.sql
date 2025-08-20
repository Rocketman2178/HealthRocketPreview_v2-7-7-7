/*
  # Prevent Duplicate FP Earnings

  1. Database Changes
    - Add partial unique index to prevent duplicate boost FP on same day
    - Update complete_boost function to avoid manual FP insertion
    - Update trigger to handle duplicates gracefully

  2. Key Changes
    - Uses partial index instead of functional index to avoid IMMUTABLE requirement
    - Prevents same user from earning FP for same boost multiple times per day
    - Maintains existing earned_at column structure
*/

-- Step 1: Add partial unique index to prevent duplicates for boosts
-- This prevents the same user from earning FP for the same boost item on the same day
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_earnings_boost_daily_unique 
ON fp_earnings (user_id, item_id, (earned_at::date)) 
WHERE item_type = 'boost';

-- Step 2: Update complete_boost function to only insert into completed_boosts
-- Let the trigger handle the FP award to avoid race conditions
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_fp_value INTEGER;
  v_boost_name TEXT;
  v_category TEXT;
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
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;
  
  IF NOT FOUND THEN
    v_fp_value := 10; -- Default FP value
    v_category := 'general';
  END IF;

  -- Get boost name from data
  v_boost_name := COALESCE(
    (SELECT name FROM boost_library WHERE id = p_boost_id),
    p_boost_id
  );

  -- Insert into completed_boosts (trigger will handle FP award)
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

  -- Return success with expected FP (actual award handled by trigger)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_value,
    'boost_name', v_boost_name,
    'category', v_category
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Update the trigger function to handle duplicates gracefully
CREATE OR REPLACE FUNCTION sync_boost_fp_earning() RETURNS TRIGGER AS $$
DECLARE
  v_fp_value INTEGER;
  v_boost_name TEXT;
  v_category TEXT;
  v_user_name TEXT;
BEGIN
  -- Get boost details
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values 
  WHERE boost_id = NEW.boost_id;
  
  IF NOT FOUND THEN
    v_fp_value := 10; -- Default FP value
    v_category := 'general';
  END IF;

  -- Get user name
  SELECT name INTO v_user_name FROM users WHERE id = NEW.user_id;
  
  -- Get boost name
  v_boost_name := COALESCE(NEW.boost_name, NEW.boost_id);

  -- Insert FP earning with duplicate protection
  INSERT INTO fp_earnings (
    user_id,
    item_id,
    item_name,
    item_type,
    health_category,
    fp_amount,
    earned_at,
    metadata,
    title,
    description,
    user_name
  ) VALUES (
    NEW.user_id,
    NEW.boost_id,
    v_boost_name,
    'boost',
    v_category,
    v_fp_value,
    NEW.completed_at,
    jsonb_build_object(
      'boost_id', NEW.boost_id,
      'completed_date', NEW.completed_date,
      'source', 'daily_boost'
    ),
    'Daily Boost Completed',
    format('Completed %s boost', v_boost_name),
    v_user_name
  )
  ON CONFLICT DO NOTHING; -- Gracefully handle duplicates

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;