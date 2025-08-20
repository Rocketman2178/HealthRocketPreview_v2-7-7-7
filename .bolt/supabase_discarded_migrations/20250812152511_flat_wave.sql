/*
  # Fix Duplicate FP Earnings for Daily Boosts

  This migration addresses the issue where users receive duplicate FP entries when completing daily boosts.

  ## Changes Made

  1. **Data Cleanup**
     - Remove duplicate FP entries from fp_earnings table
     - Clean up orphaned records with invalid user_ids
     - Add date_earned column for better indexing

  2. **Prevent Future Duplicates**
     - Create unique constraint on (user_id, item_id, item_type, date_earned)
     - Update complete_boost RPC function to only insert into completed_boosts
     - Let trigger handle FP awards exclusively

  3. **Enhanced Trigger Function**
     - Make sync_boost_fp_earning trigger the single source of truth for boost FP
     - Add proper duplicate prevention with ON CONFLICT DO NOTHING
     - Improve error handling and logging

  4. **Logging and Monitoring**
     - Add boost_completion_logs table for debugging
     - Track completion attempts and any issues
*/

-- Step 1: Clean up orphaned fp_earnings records
DELETE FROM fp_earnings 
WHERE user_id NOT IN (SELECT id FROM users);

-- Step 2: Add date_earned column to fp_earnings if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fp_earnings' AND column_name = 'date_earned'
  ) THEN
    ALTER TABLE fp_earnings ADD COLUMN date_earned DATE;
  END IF;
END $$;

-- Step 3: Populate date_earned column for existing records
UPDATE fp_earnings 
SET date_earned = DATE(earned_at) 
WHERE date_earned IS NULL;

-- Step 4: Make date_earned NOT NULL with default
ALTER TABLE fp_earnings 
ALTER COLUMN date_earned SET DEFAULT CURRENT_DATE,
ALTER COLUMN date_earned SET NOT NULL;

-- Step 5: Remove duplicate FP entries (keep the earliest one for each user/boost/date)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, item_id, item_type, date_earned 
      ORDER BY earned_at ASC
    ) as rn
  FROM fp_earnings
  WHERE item_type = 'boost'
)
DELETE FROM fp_earnings 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 6: Create unique constraint to prevent future duplicates
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fp_earnings_unique_daily_boost'
  ) THEN
    ALTER TABLE fp_earnings DROP CONSTRAINT fp_earnings_unique_daily_boost;
  END IF;
  
  -- Create new unique constraint
  ALTER TABLE fp_earnings 
  ADD CONSTRAINT fp_earnings_unique_daily_boost 
  UNIQUE (user_id, item_id, item_type, date_earned);
EXCEPTION
  WHEN duplicate_table THEN
    -- Constraint already exists, ignore
    NULL;
END $$;

-- Step 7: Create boost completion logs table for debugging
CREATE TABLE IF NOT EXISTS boost_completion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  boost_id TEXT NOT NULL,
  completion_date DATE DEFAULT CURRENT_DATE,
  fp_awarded INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on boost_completion_logs
ALTER TABLE boost_completion_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for boost_completion_logs
CREATE POLICY "Users can view own boost completion logs"
  ON boost_completion_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Step 8: Update the sync_boost_fp_earning trigger function
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER AS $$
DECLARE
  v_user_name TEXT;
  v_boost_name TEXT;
  v_fp_value INTEGER := 10; -- Default FP value
BEGIN
  -- Only process boost completions
  IF TG_TABLE_NAME != 'completed_boosts' OR TG_OP != 'INSERT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Get user name
  SELECT name INTO v_user_name 
  FROM users 
  WHERE id = NEW.user_id;

  -- Get boost name and FP value
  SELECT boost_name INTO v_boost_name 
  FROM completed_boosts 
  WHERE id = NEW.id;
  
  -- Try to get FP value from boost_fp_values table
  SELECT fp_value INTO v_fp_value
  FROM boost_fp_values
  WHERE boost_id = NEW.boost_id;
  
  -- If not found, use default
  IF v_fp_value IS NULL THEN
    v_fp_value := 10;
  END IF;

  -- Insert FP earning with duplicate prevention
  BEGIN
    INSERT INTO fp_earnings (
      user_id,
      item_id,
      item_name,
      item_type,
      fp_amount,
      earned_at,
      date_earned,
      user_name,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.boost_id,
      COALESCE(v_boost_name, NEW.boost_id),
      'boost',
      v_fp_value,
      NEW.completed_at,
      NEW.completed_date,
      v_user_name,
      jsonb_build_object(
        'boost_id', NEW.boost_id,
        'completion_method', 'daily_boost',
        'awarded_by', 'sync_boost_fp_earning_trigger'
      )
    );
    
    -- Log successful completion
    INSERT INTO boost_completion_logs (
      user_id,
      boost_id,
      completion_date,
      fp_awarded,
      success,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.boost_id,
      NEW.completed_date,
      v_fp_value,
      true,
      jsonb_build_object('trigger_source', 'sync_boost_fp_earning')
    );
    
  EXCEPTION
    WHEN unique_violation THEN
      -- Log the duplicate attempt but don't fail
      INSERT INTO boost_completion_logs (
        user_id,
        boost_id,
        completion_date,
        fp_awarded,
        success,
        error_message,
        metadata
      ) VALUES (
        NEW.user_id,
        NEW.boost_id,
        NEW.completed_date,
        0,
        false,
        'Duplicate FP entry prevented',
        jsonb_build_object(
          'trigger_source', 'sync_boost_fp_earning',
          'error_type', 'duplicate_prevention'
        )
      );
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Update the complete_boost RPC function
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_fp_value INTEGER := 10;
  v_boost_name TEXT;
  v_user_name TEXT;
  v_existing_completion_id UUID;
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL OR p_boost_id IS NULL OR p_boost_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid user ID or boost ID'
    );
  END IF;

  -- Check if user exists
  SELECT name INTO v_user_name FROM users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Check if boost was already completed today
  SELECT id INTO v_existing_completion_id
  FROM completed_boosts
  WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = v_today;

  IF v_existing_completion_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today'
    );
  END IF;

  -- Get boost details
  SELECT fp_value INTO v_fp_value
  FROM boost_fp_values
  WHERE boost_id = p_boost_id;
  
  IF v_fp_value IS NULL THEN
    v_fp_value := 10; -- Default value
  END IF;

  -- Set boost name
  v_boost_name := COALESCE(
    (SELECT boost_code FROM boost_codes WHERE id::text = p_boost_id LIMIT 1),
    p_boost_id
  );

  -- Insert into completed_boosts ONLY
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

  -- Return success with expected FP (actual award handled by trigger)
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_value,
    'boost_id', p_boost_id,
    'completion_date', v_today,
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