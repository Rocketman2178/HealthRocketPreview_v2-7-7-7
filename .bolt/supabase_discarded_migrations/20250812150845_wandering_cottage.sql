/*
  # Investigate Boost FP Duplication Issue

  This migration investigates the duplicate FP entries being created when users complete daily boosts.
  
  ## Investigation Summary
  
  The issue appears to be that both the `complete_boost` RPC function AND the 
  `sync_boost_fp_earning_trigger` are awarding FP for the same boost completion,
  creating duplicate entries in the fp_earnings table.
  
  ## Current Flow Analysis
  
  1. User completes boost via frontend
  2. `complete_boost` RPC function is called
  3. RPC function inserts into `completed_boosts` table
  4. RPC function ALSO awards FP directly (first entry)
  5. `sync_boost_fp_earning_trigger` fires on the `completed_boosts` INSERT
  6. Trigger ALSO awards FP (second entry - duplicate)
  
  ## Solution
  
  Remove the manual FP awarding from the `complete_boost` RPC function and let
  the trigger handle ALL FP awards consistently. This ensures single source of truth.
*/

-- First, let's examine the current complete_boost function
DO $$
BEGIN
  -- Check if complete_boost function exists and examine its definition
  IF EXISTS (
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE p.proname = 'complete_boost' AND n.nspname = 'public'
  ) THEN
    RAISE NOTICE 'complete_boost function exists';
  ELSE
    RAISE NOTICE 'complete_boost function does not exist';
  END IF;
END $$;

-- Check the sync_boost_fp_earning trigger
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'sync_boost_fp_earning_trigger'
  ) THEN
    RAISE NOTICE 'sync_boost_fp_earning_trigger exists';
  ELSE
    RAISE NOTICE 'sync_boost_fp_earning_trigger does not exist';
  END IF;
END $$;

-- Create the fixed complete_boost function that only handles boost completion
-- without manually awarding FP (let the trigger handle it)
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_boost_fp INTEGER;
  v_today DATE;
  v_existing_boost_id UUID;
  v_user_exists BOOLEAN;
BEGIN
  -- Input validation
  IF p_user_id IS NULL OR p_boost_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User ID and boost ID are required'
    );
  END IF;

  -- Check if user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = p_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Get today's date
  v_today := CURRENT_DATE;

  -- Check if boost was already completed today (prevent duplicates)
  SELECT id INTO v_existing_boost_id
  FROM completed_boosts 
  WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today;

  IF v_existing_boost_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;

  -- Check daily boost limit (max 3 per day)
  IF (
    SELECT COUNT(*) 
    FROM completed_boosts 
    WHERE user_id = p_user_id 
      AND completed_date = v_today
  ) >= 3 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily boost limit reached (3 per day)'
    );
  END IF;

  -- Get boost FP value from boost_fp_values table
  SELECT fp_value INTO v_boost_fp
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;

  -- If not found in boost_fp_values, use default of 10 FP
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10;
  END IF;

  -- Insert completed boost record
  -- The trigger will automatically handle FP awarding
  INSERT INTO completed_boosts (
    user_id,
    boost_id,
    completed_at,
    completed_date
  ) VALUES (
    p_user_id,
    p_boost_id,
    NOW(),
    v_today
  );

  -- Return success (FP will be awarded by trigger)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_boost_fp,
    'message', 'Boost completed successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'details', SQLSTATE
    );
END;
$$;

-- Ensure the sync_boost_fp_earning trigger function exists and works correctly
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boost_fp INTEGER;
  v_boost_name TEXT;
  v_user_name TEXT;
  v_category TEXT;
BEGIN
  -- Get boost FP value and details
  SELECT fp_value, category INTO v_boost_fp, v_category
  FROM boost_fp_values 
  WHERE boost_id = NEW.boost_id;

  -- If not found in boost_fp_values, use default
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10;
    v_category := 'general';
  END IF;

  -- Get user name for caching
  SELECT name INTO v_user_name
  FROM users 
  WHERE id = NEW.user_id;

  -- Create descriptive boost name
  v_boost_name := COALESCE(
    (SELECT name FROM boost_library WHERE id = NEW.boost_id),
    'Daily Boost: ' || NEW.boost_id
  );

  -- Award FP via fp_earnings table (single source of truth)
  INSERT INTO fp_earnings (
    user_id,
    item_id,
    item_name,
    item_type,
    health_category,
    fp_amount,
    earned_at,
    title,
    description,
    user_name
  ) VALUES (
    NEW.user_id,
    NEW.boost_id,
    v_boost_name,
    'boost',
    v_category,
    v_boost_fp,
    NEW.completed_at,
    v_boost_name,
    'Completed daily boost for ' || v_category || ' category',
    v_user_name
  )
  ON CONFLICT (user_id, item_id, item_type, DATE(earned_at)) 
  DO NOTHING; -- Prevent duplicates if somehow called twice

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the boost completion
    INSERT INTO debug_logs (operation, table_name, record_id, details, success)
    VALUES (
      'sync_boost_fp_earning',
      'completed_boosts',
      NEW.id::TEXT,
      jsonb_build_object(
        'error', SQLERRM,
        'boost_id', NEW.boost_id,
        'user_id', NEW.user_id
      ),
      false
    );
    
    RETURN NEW;
END;
$$;

-- Ensure the trigger exists and is properly configured
DROP TRIGGER IF EXISTS sync_boost_fp_earning_trigger ON completed_boosts;

CREATE TRIGGER sync_boost_fp_earning_trigger
  AFTER INSERT ON completed_boosts
  FOR EACH ROW
  EXECUTE FUNCTION sync_boost_fp_earning();

-- Add a unique constraint to prevent duplicate FP earnings for the same boost on the same day
DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fp_earnings_boost_daily_unique'
  ) THEN
    -- Add unique constraint to prevent duplicate boost FP on same day
    ALTER TABLE fp_earnings 
    ADD CONSTRAINT fp_earnings_boost_daily_unique 
    UNIQUE (user_id, item_id, item_type, DATE(earned_at))
    WHERE item_type = 'boost';
  END IF;
END $$;

-- Create a function to clean up existing duplicates
CREATE OR REPLACE FUNCTION cleanup_duplicate_boost_fp()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duplicates_removed INTEGER := 0;
  v_duplicate_record RECORD;
BEGIN
  -- Find and remove duplicate boost FP entries (keep the first one)
  FOR v_duplicate_record IN
    SELECT 
      user_id,
      item_id,
      item_type,
      DATE(earned_at) as earn_date,
      COUNT(*) as duplicate_count,
      MIN(id) as keep_id
    FROM fp_earnings 
    WHERE item_type = 'boost'
    GROUP BY user_id, item_id, item_type, DATE(earned_at)
    HAVING COUNT(*) > 1
  LOOP
    -- Delete all duplicates except the first one
    DELETE FROM fp_earnings 
    WHERE user_id = v_duplicate_record.user_id
      AND item_id = v_duplicate_record.item_id
      AND item_type = v_duplicate_record.item_type
      AND DATE(earned_at) = v_duplicate_record.earn_date
      AND id != v_duplicate_record.keep_id;
    
    v_duplicates_removed := v_duplicates_removed + (v_duplicate_record.duplicate_count - 1);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'duplicates_removed', v_duplicates_removed,
    'message', 'Duplicate boost FP entries cleaned up'
  );
END;
$$;