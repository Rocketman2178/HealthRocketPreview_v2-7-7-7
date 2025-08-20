/*
  # Fix Duplicate FP Earnings for Daily Boosts

  1. Problem Analysis
    - Users are getting duplicate FP entries when completing daily boosts
    - One entry from RPC function, another from trigger
    - Need to clean up existing duplicates and prevent future ones

  2. Solution
    - Remove duplicate FP entries (keep the first one chronologically)
    - Update complete_boost RPC to only insert into completed_boosts
    - Let the trigger handle FP awards automatically
    - Add safeguards to prevent future duplicates

  3. Changes Made
    - Clean up duplicate fp_earnings entries for boosts
    - Update complete_boost RPC function
    - Add unique constraint to prevent duplicates
*/

-- Step 1: Clean up existing duplicate FP entries for boosts
-- Keep only the earliest entry for each user/boost/date combination
WITH duplicate_entries AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, item_id, DATE(earned_at) 
      ORDER BY earned_at ASC
    ) as rn
  FROM fp_earnings 
  WHERE item_type = 'boost'
    AND item_id IS NOT NULL
),
entries_to_delete AS (
  SELECT id 
  FROM duplicate_entries 
  WHERE rn > 1
)
DELETE FROM fp_earnings 
WHERE id IN (SELECT id FROM entries_to_delete);

-- Step 2: Create a unique index to prevent future duplicates
-- Use a functional index on the date part of earned_at
CREATE UNIQUE INDEX IF NOT EXISTS idx_fp_earnings_boost_unique 
ON fp_earnings (user_id, item_id, item_type, (DATE(earned_at))) 
WHERE item_type = 'boost' AND item_id IS NOT NULL;

-- Step 3: Update the complete_boost RPC function to only insert into completed_boosts
-- and let the trigger handle FP awards
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_boost_exists BOOLEAN := FALSE;
  v_fp_value INTEGER := 10; -- Default FP value
  v_boost_name TEXT;
  v_result JSONB;
BEGIN
  -- Check if boost was already completed today
  SELECT EXISTS(
    SELECT 1 FROM completed_boosts 
    WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today
  ) INTO v_boost_exists;
  
  IF v_boost_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;
  
  -- Get boost FP value from boost_fp_values table if it exists
  SELECT fp_value INTO v_fp_value
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;
  
  -- If not found, use default value
  IF v_fp_value IS NULL THEN
    v_fp_value := 10;
  END IF;
  
  -- Generate boost name for display
  v_boost_name := COALESCE(
    (SELECT boost_code FROM boost_codes WHERE boost_code = p_boost_id LIMIT 1),
    'Daily Boost: ' || p_boost_id
  );
  
  -- Insert into completed_boosts table ONLY
  -- The trigger will handle FP award automatically
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
  
  -- Return success with expected FP (trigger will award it)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_value,
    'boost_name', v_boost_name,
    'message', 'Boost completed successfully'
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Ensure the sync_boost_fp_earning trigger function works correctly
-- This function should be the ONLY place that awards FP for boost completions
CREATE OR REPLACE FUNCTION sync_boost_fp_earning() RETURNS TRIGGER AS $$
DECLARE
  v_fp_value INTEGER := 10;
  v_category TEXT := 'general';
  v_description TEXT;
BEGIN
  -- Get boost FP value and category
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values 
  WHERE boost_id = NEW.boost_id;
  
  -- Use defaults if not found
  IF v_fp_value IS NULL THEN
    v_fp_value := 10;
  END IF;
  
  IF v_category IS NULL THEN
    v_category := 'general';
  END IF;
  
  -- Create description
  v_description := COALESCE(NEW.boost_name, 'Daily Boost: ' || NEW.boost_id);
  
  -- Insert into fp_earnings (this is the authoritative FP award)
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
    v_description,
    'boost',
    v_category,
    v_fp_value,
    NEW.completed_at,
    'Daily Boost Completed',
    v_description,
    (SELECT name FROM users WHERE id = NEW.user_id)
  )
  ON CONFLICT (user_id, item_id, item_type, (DATE(earned_at))) 
  WHERE item_type = 'boost' AND item_id IS NOT NULL
  DO NOTHING; -- Prevent duplicates
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Add logging to track any remaining issues
CREATE TABLE IF NOT EXISTS boost_completion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  boost_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'rpc_call', 'trigger_fire', 'fp_award'
  success BOOLEAN NOT NULL,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on the new table
ALTER TABLE boost_completion_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for the logs table
CREATE POLICY "Users can view own boost completion logs"
  ON boost_completion_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);