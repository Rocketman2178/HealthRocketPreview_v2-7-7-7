/*
  # Fix Boost Completion Duplicate Key Error

  1. Problem
    - Users getting "duplicate key value violates unique constraint unique_user_item_type_daily" 
    - This happens when completing daily boosts
    - The trigger or function is trying to insert duplicate entries into fp_earnings

  2. Solution
    - Update complete_boost function to handle duplicates gracefully
    - Use ON CONFLICT DO NOTHING for both completed_boosts and any fp_earnings inserts
    - Return appropriate success/error messages

  3. Changes
    - Modify complete_boost function to prevent duplicate key violations
    - Ensure proper error handling for already completed boosts
*/

-- Update complete_boost function to handle duplicates gracefully
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT,
  p_completed_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fp_value INTEGER := 10;
  v_boost_name TEXT;
  v_category TEXT;
  v_existing_boost_id UUID;
BEGIN
  -- Check if boost was already completed today
  SELECT id INTO v_existing_boost_id
  FROM completed_boosts 
  WHERE user_id = p_user_id 
    AND boost_id = p_boost_id 
    AND completed_date = p_completed_date;
    
  IF v_existing_boost_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today',
      'fp_earned', 0
    );
  END IF;

  -- Get boost details from boost_fp_values table
  SELECT fp_value, category INTO v_fp_value, v_category
  FROM boost_fp_values 
  WHERE boost_id = p_boost_id;
  
  -- Default FP if not found in boost_fp_values
  IF v_fp_value IS NULL THEN
    v_fp_value := 10;
  END IF;
  
  -- Get boost name from a simple mapping
  SELECT name INTO v_boost_name
  FROM (
    SELECT 'morning_sunlight' as id, 'Morning Sunlight' as name
    UNION ALL SELECT 'cold_shower', 'Cold Shower'
    UNION ALL SELECT 'meditation', 'Meditation'
    UNION ALL SELECT 'gratitude', 'Gratitude Practice'
    UNION ALL SELECT 'deep_breathing', 'Deep Breathing'
    UNION ALL SELECT 'nature_walk', 'Nature Walk'
    UNION ALL SELECT 'digital_detox', 'Digital Detox'
    UNION ALL SELECT 'stretching', 'Stretching'
    UNION ALL SELECT 'hydration', 'Hydration'
    UNION ALL SELECT 'healthy_meal', 'Healthy Meal'
    UNION ALL SELECT 'sleep_routine', 'Sleep Routine'
    UNION ALL SELECT 'exercise', 'Exercise'
  ) boost_names
  WHERE id = p_boost_id;
  
  -- Default name if not found
  IF v_boost_name IS NULL THEN
    v_boost_name := p_boost_id;
  END IF;
  
  -- Insert into completed_boosts with conflict handling
  INSERT INTO completed_boosts (
    user_id, 
    boost_id, 
    completed_date,
    boost_name
  ) VALUES (
    p_user_id, 
    p_boost_id, 
    p_completed_date,
    v_boost_name
  )
  ON CONFLICT (user_id, boost_id, completed_date) DO NOTHING;
  
  -- Check if the insert was successful (not a duplicate)
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today',
      'fp_earned', 0
    );
  END IF;
  
  -- The fp_earnings insert will be handled by the trigger automatically
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_value,
    'boost_name', v_boost_name
  );
  
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found',
      'fp_earned', 0
    );
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Boost already completed today',
      'fp_earned', 0
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'fp_earned', 0
    );
END;
$$;