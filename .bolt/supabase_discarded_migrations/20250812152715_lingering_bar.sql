/*
  # Prevent Duplicate FP Earnings

  1. Database Changes
    - Add date_earned column to fp_earnings table
    - Create unique constraint to prevent duplicates
    - Update complete_boost function to prevent double-awarding

  2. Function Updates
    - Modify complete_boost to only insert into completed_boosts
    - Let existing triggers handle FP awards
    - Add duplicate prevention logic

  3. Security
    - Maintain existing RLS policies
    - No changes to user permissions
*/

-- Add date_earned column to fp_earnings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fp_earnings' AND column_name = 'date_earned'
  ) THEN
    ALTER TABLE fp_earnings ADD COLUMN date_earned DATE DEFAULT CURRENT_DATE;
    
    -- Populate existing records
    UPDATE fp_earnings 
    SET date_earned = DATE(earned_at) 
    WHERE date_earned IS NULL;
    
    -- Make it NOT NULL after populating
    ALTER TABLE fp_earnings ALTER COLUMN date_earned SET NOT NULL;
  END IF;
END $$;

-- Create unique constraint to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fp_earnings_unique_daily_boost'
  ) THEN
    CREATE UNIQUE INDEX fp_earnings_unique_daily_boost 
    ON fp_earnings (user_id, item_id, item_type, date_earned)
    WHERE item_type = 'boost';
  END IF;
END $$;

-- Update complete_boost function to prevent duplicates
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fp_value INTEGER;
  v_boost_name TEXT;
  v_category TEXT;
  v_today DATE := CURRENT_DATE;
  v_completed_today INTEGER;
  v_daily_limit INTEGER := 3;
  v_already_completed BOOLEAN := FALSE;
BEGIN
  -- Check if boost was already completed today
  SELECT COUNT(*) INTO v_completed_today
  FROM completed_boosts
  WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today;
    
  IF v_completed_today > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;

  -- Check daily limit
  SELECT COUNT(*) INTO v_completed_today
  FROM completed_boosts
  WHERE user_id = p_user_id 
    AND completed_date = v_today;
    
  IF v_completed_today >= v_daily_limit THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily boost limit reached'
    );
  END IF;

  -- Get boost details
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values
  WHERE boost_id = p_boost_id;
  
  IF v_fp_value IS NULL THEN
    v_fp_value := 1; -- Default FP value
    v_category := 'general';
  END IF;

  -- Get boost name from boosts data
  v_boost_name := COALESCE(
    (SELECT name FROM boost_library WHERE id = p_boost_id LIMIT 1),
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

  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_value,
    'boost_name', v_boost_name,
    'category', v_category
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to complete boost: ' || SQLERRM
    );
END;
$$;

-- Update sync_boost_fp_earning trigger function to use date_earned
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fp_value INTEGER;
  v_category TEXT;
  v_user_name TEXT;
  v_boost_name TEXT;
BEGIN
  -- Get boost details
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values
  WHERE boost_id = NEW.boost_id;
  
  IF v_fp_value IS NULL THEN
    v_fp_value := 1;
    v_category := 'general';
  END IF;

  -- Get user name
  SELECT name INTO v_user_name
  FROM users
  WHERE id = NEW.user_id;

  -- Get boost name
  v_boost_name := COALESCE(NEW.boost_name, NEW.boost_id);

  -- Insert FP earning with duplicate prevention
  INSERT INTO fp_earnings (
    user_id,
    item_id,
    item_name,
    item_type,
    health_category,
    fp_amount,
    earned_at,
    date_earned,
    user_name,
    title,
    description
  ) VALUES (
    NEW.user_id,
    NEW.boost_id,
    v_boost_name,
    'boost',
    v_category,
    v_fp_value,
    NEW.completed_at,
    NEW.completed_date,
    v_user_name,
    'Daily Boost Completed',
    'Completed boost: ' || v_boost_name
  )
  ON CONFLICT (user_id, item_id, item_type, date_earned) 
  DO NOTHING;

  RETURN NEW;
END;
$$;