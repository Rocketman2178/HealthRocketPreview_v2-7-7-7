/*
  # Fix Duplicate FP Earnings for Daily Boosts

  This migration addresses the issue where users receive duplicate FP entries when completing daily boosts.
  
  ## Root Cause
  The `complete_boost` RPC function was manually inserting FP entries AND the `sync_boost_fp_earning_trigger` 
  was also inserting FP entries, causing duplicates.

  ## Solution
  1. Clean up existing duplicate FP entries
  2. Create unique constraint to prevent future duplicates  
  3. Update `complete_boost` RPC to only insert into completed_boosts (let trigger handle FP)
  4. Enhance trigger function with duplicate prevention

  ## Changes
  1. Remove duplicate FP entries (keep most recent)
  2. Add unique constraint on (user_id, item_id, item_type, date_earned)
  3. Update complete_boost RPC function
  4. Update sync_boost_fp_earning trigger function
  5. Add logging table for debugging
*/

-- Step 1: Add date_earned column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fp_earnings' AND column_name = 'date_earned'
  ) THEN
    ALTER TABLE fp_earnings ADD COLUMN date_earned DATE;
  END IF;
END $$;

-- Step 2: Populate date_earned column
UPDATE fp_earnings 
SET date_earned = earned_at::date 
WHERE date_earned IS NULL;

-- Step 3: Make date_earned NOT NULL with default
ALTER TABLE fp_earnings 
ALTER COLUMN date_earned SET DEFAULT CURRENT_DATE,
ALTER COLUMN date_earned SET NOT NULL;

-- Step 4: Clean up duplicate FP entries for boosts
-- Keep only the most recent entry for each user/boost/date combination
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, item_id, item_type, date_earned 
      ORDER BY earned_at DESC
    ) as rn
  FROM fp_earnings 
  WHERE item_type = 'boost'
),
to_delete AS (
  SELECT id FROM duplicates WHERE rn > 1
)
DELETE FROM fp_earnings 
WHERE id IN (SELECT id FROM to_delete);

-- Step 5: Create unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_earnings_unique_boost_daily
ON fp_earnings (user_id, item_id, item_type, date_earned)
WHERE item_type = 'boost';

-- Step 6: Create logging table for debugging
CREATE TABLE IF NOT EXISTS boost_completion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  boost_id TEXT NOT NULL,
  action TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  fp_awarded INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Step 7: Update complete_boost RPC function to remove manual FP insertion
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boost_fp INTEGER;
  v_today DATE := CURRENT_DATE;
  v_existing_boost_id UUID;
  v_result JSONB;
BEGIN
  -- Log the attempt
  INSERT INTO boost_completion_logs (user_id, boost_id, action, success, metadata)
  VALUES (p_user_id, p_boost_id, 'attempt', false, jsonb_build_object('timestamp', now()));

  -- Check if boost was already completed today
  SELECT id INTO v_existing_boost_id
  FROM completed_boosts 
  WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today;
    
  IF v_existing_boost_id IS NOT NULL THEN
    -- Log duplicate attempt
    INSERT INTO boost_completion_logs (user_id, boost_id, action, success, error_message)
    VALUES (p_user_id, p_boost_id, 'duplicate_attempt', false, 'Boost already completed today');
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;

  -- Get boost FP value
  SELECT fp_value INTO v_boost_fp
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;
  
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10; -- Default FP value
  END IF;

  -- Insert into completed_boosts (trigger will handle FP award)
  INSERT INTO completed_boosts (
    user_id,
    boost_id,
    completed_at,
    completed_date
  ) VALUES (
    p_user_id,
    p_boost_id,
    now(),
    v_today
  );

  -- Log successful completion
  INSERT INTO boost_completion_logs (user_id, boost_id, action, success, fp_awarded)
  VALUES (p_user_id, p_boost_id, 'completed', true, v_boost_fp);

  -- Return success (FP will be awarded by trigger)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_boost_fp,
    'message', 'Boost completed successfully'
  );

EXCEPTION WHEN OTHERS THEN
  -- Log the error
  INSERT INTO boost_completion_logs (user_id, boost_id, action, success, error_message)
  VALUES (p_user_id, p_boost_id, 'error', false, SQLERRM);
  
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to complete boost: ' || SQLERRM
  );
END;
$$;

-- Step 8: Update sync_boost_fp_earning trigger function with duplicate prevention
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boost_name TEXT;
  v_boost_fp INTEGER;
  v_category TEXT;
  v_existing_id UUID;
BEGIN
  -- Get boost details
  SELECT fp_value, category INTO v_boost_fp, v_category
  FROM boost_fp_values 
  WHERE boost_id = NEW.boost_id;
  
  IF v_boost_fp IS NULL THEN
    v_boost_fp := 10; -- Default FP value
    v_category := 'general';
  END IF;

  -- Get boost name from the boosts data or use boost_id
  v_boost_name := COALESCE(NEW.boost_name, NEW.boost_id);

  -- Check if FP entry already exists (prevent duplicates)
  SELECT id INTO v_existing_id
  FROM fp_earnings
  WHERE user_id = NEW.user_id
    AND item_id = NEW.boost_id
    AND item_type = 'boost'
    AND date_earned = NEW.completed_date;

  -- Only insert if no existing entry
  IF v_existing_id IS NULL THEN
    INSERT INTO fp_earnings (
      user_id,
      item_id,
      item_name,
      item_type,
      health_category,
      fp_amount,
      earned_at,
      date_earned,
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
      NEW.completed_date,
      'Daily Boost Completed',
      'Completed daily boost: ' || v_boost_name,
      NEW.user_name
    )
    ON CONFLICT (user_id, item_id, item_type, date_earned) DO NOTHING;

    -- Log successful FP award
    INSERT INTO boost_completion_logs (user_id, boost_id, action, success, fp_awarded, metadata)
    VALUES (NEW.user_id, NEW.boost_id, 'fp_awarded_by_trigger', true, v_boost_fp, 
            jsonb_build_object('boost_name', v_boost_name, 'category', v_category));
  ELSE
    -- Log duplicate prevention
    INSERT INTO boost_completion_logs (user_id, boost_id, action, success, error_message)
    VALUES (NEW.user_id, NEW.boost_id, 'duplicate_fp_prevented', true, 'FP entry already exists');
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Log any errors
  INSERT INTO boost_completion_logs (user_id, boost_id, action, success, error_message)
  VALUES (NEW.user_id, NEW.boost_id, 'trigger_error', false, SQLERRM);
  
  -- Don't fail the transaction, just log the error
  RETURN NEW;
END;
$$;