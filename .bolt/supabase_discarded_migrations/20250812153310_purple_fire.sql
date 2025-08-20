/*
  # Prevent Duplicate FP Earnings

  1. Changes
    - Add unique constraint to prevent duplicate boost FP awards
    - Update complete_boost function to handle duplicates gracefully
    - Update trigger function to prevent duplicate FP entries

  2. Security
    - No changes to RLS policies
    - Maintains existing data integrity
*/

-- Add unique constraint to prevent duplicate FP awards for the same item on the same day
-- We'll use a combination of user_id, item_id, and item_type to prevent duplicates
ALTER TABLE fp_earnings 
ADD CONSTRAINT unique_user_item_type_daily 
UNIQUE (user_id, item_id, item_type);

-- Update complete_boost function to handle duplicates gracefully
CREATE OR REPLACE FUNCTION complete_boost(
  p_user_id UUID,
  p_boost_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_fp_earned INTEGER := 10;
  v_user_name TEXT;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Get user name
  SELECT name INTO v_user_name
  FROM users 
  WHERE id = p_user_id;

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

  -- Insert into completed_boosts only
  INSERT INTO completed_boosts (
    user_id,
    boost_id,
    completed_date,
    boost_name,
    user_name
  ) VALUES (
    p_user_id,
    p_boost_id,
    v_today,
    p_boost_id,
    v_user_name
  );

  -- The trigger will handle FP earnings insertion
  
  RETURN jsonb_build_object(
    'success', true,
    'fp_earned', v_fp_earned
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
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the trigger function to handle duplicates gracefully
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER AS $$
DECLARE
  v_user_name TEXT;
  v_fp_amount INTEGER := 10;
BEGIN
  -- Get user name
  SELECT name INTO v_user_name
  FROM users 
  WHERE id = NEW.user_id;

  -- Insert FP earning with duplicate handling
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
    COALESCE(NEW.boost_name, NEW.boost_id),
    'boost',
    'general',
    v_fp_amount,
    NEW.completed_at,
    jsonb_build_object('boost_id', NEW.boost_id),
    'Daily Boost Completed',
    'Completed boost: ' || COALESCE(NEW.boost_name, NEW.boost_id),
    v_user_name
  )
  ON CONFLICT (user_id, item_id, item_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;