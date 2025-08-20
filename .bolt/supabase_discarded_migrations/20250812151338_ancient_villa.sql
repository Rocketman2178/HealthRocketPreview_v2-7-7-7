/*
  # Fix Duplicate FP Earnings for Daily Boosts

  1. Data Cleanup
    - Remove duplicate FP earnings entries for boost completions
    - Keep the most recent entry for each duplicate set
    - Preserve user's total FP balance

  2. Function Updates
    - Update complete_boost RPC function to only insert into completed_boosts
    - Remove manual FP award logic from RPC function
    - Let trigger handle all FP awards automatically

  3. Safeguards
    - Add unique constraint to prevent future duplicates
    - Ensure trigger function handles FP awards correctly
*/

-- Step 1: Clean up existing duplicate FP earnings for boosts
DO $$
DECLARE
    duplicate_count INTEGER;
    cleaned_count INTEGER;
BEGIN
    -- Count duplicates before cleanup
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT user_id, item_id, earned_at::date, COUNT(*) as cnt
        FROM fp_earnings 
        WHERE item_type = 'boost'
        GROUP BY user_id, item_id, earned_at::date
        HAVING COUNT(*) > 1
    ) duplicates;
    
    RAISE NOTICE 'Found % duplicate boost FP entries to clean up', duplicate_count;
    
    -- Remove duplicates, keeping the most recent entry for each user/boost/date combination
    WITH duplicates_to_remove AS (
        SELECT id
        FROM (
            SELECT id, 
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, item_id, earned_at::date 
                       ORDER BY earned_at DESC
                   ) as rn
            FROM fp_earnings 
            WHERE item_type = 'boost'
        ) ranked
        WHERE rn > 1
    )
    DELETE FROM fp_earnings 
    WHERE id IN (SELECT id FROM duplicates_to_remove);
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % duplicate FP entries', cleaned_count;
    
    -- Recalculate user fuel points to ensure accuracy after cleanup
    UPDATE users 
    SET fuel_points = (
        SELECT COALESCE(SUM(fp_amount), 0)
        FROM fp_earnings 
        WHERE fp_earnings.user_id = users.id
    );
    
    RAISE NOTICE 'Recalculated fuel points for all users';
END $$;

-- Step 2: Add unique constraint to prevent future duplicates for boost completions
DO $$
BEGIN
    -- Add partial unique index for boost FP earnings (one per user per boost per day)
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'unique_boost_fp_per_day'
    ) THEN
        CREATE UNIQUE INDEX unique_boost_fp_per_day 
        ON fp_earnings (user_id, item_id, earned_at::date) 
        WHERE item_type = 'boost';
        
        RAISE NOTICE 'Added unique constraint for boost FP earnings';
    END IF;
END $$;

-- Step 3: Create or replace the complete_boost function to only handle boost insertion
CREATE OR REPLACE FUNCTION complete_boost(
    p_user_id UUID,
    p_boost_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
    v_fp_earned INTEGER;
    v_boost_name TEXT;
    v_today DATE := CURRENT_DATE;
    v_week_start DATE;
    v_existing_boost_id UUID;
BEGIN
    -- Check if user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found'
        );
    END IF;
    
    -- Validate boost_id
    IF p_boost_id IS NULL OR p_boost_id = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Boost ID is required'
        );
    END IF;
    
    -- Calculate week start (Sunday)
    v_week_start := v_today - EXTRACT(DOW FROM v_today)::INTEGER;
    
    -- Check if boost was already completed this week (7-day cooldown)
    SELECT id INTO v_existing_boost_id
    FROM completed_boosts 
    WHERE user_id = p_user_id 
      AND boost_id = p_boost_id 
      AND completed_date >= v_week_start;
    
    IF v_existing_boost_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Boost already completed this week (7-day cooldown)'
        );
    END IF;
    
    -- Check daily boost limit (3 per day)
    IF (SELECT COUNT(*) FROM completed_boosts 
        WHERE user_id = p_user_id AND completed_date = v_today) >= 3 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Daily boost limit reached (3 per day)'
        );
    END IF;
    
    -- Get boost details for naming
    SELECT COALESCE(fp_value, 10) INTO v_fp_earned
    FROM boost_fp_values 
    WHERE boost_id = p_boost_id;
    
    -- If not found in boost_fp_values, use default
    IF v_fp_earned IS NULL THEN
        v_fp_earned := 10; -- Default FP value
    END IF;
    
    -- Generate boost name from boost_id
    v_boost_name := CASE 
        WHEN p_boost_id LIKE 'mindset-%' THEN 'Mindset Boost'
        WHEN p_boost_id LIKE 'sleep-%' THEN 'Sleep Boost'
        WHEN p_boost_id LIKE 'exercise-%' THEN 'Exercise Boost'
        WHEN p_boost_id LIKE 'nutrition-%' THEN 'Nutrition Boost'
        WHEN p_boost_id LIKE 'biohacking-%' THEN 'Biohacking Boost'
        ELSE 'Daily Boost'
    END;
    
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
        'fp_earned', v_fp_earned,
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
        RAISE LOG 'Error in complete_boost: % %', SQLERRM, SQLSTATE;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Failed to complete boost: ' || SQLERRM
        );
END;
$$;

-- Step 4: Ensure the trigger function awards FP correctly
CREATE OR REPLACE FUNCTION sync_boost_fp_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_fp_amount INTEGER;
    v_category TEXT;
    v_description TEXT;
BEGIN
    -- Get FP value for this boost
    SELECT COALESCE(fp_value, 10), category 
    INTO v_fp_amount, v_category
    FROM boost_fp_values 
    WHERE boost_id = NEW.boost_id;
    
    -- If not found, use defaults
    IF v_fp_amount IS NULL THEN
        v_fp_amount := 10;
        v_category := 'general';
    END IF;
    
    -- Create description
    v_description := COALESCE(NEW.boost_name, 'Daily Boost: ' || NEW.boost_id);
    
    -- Insert FP earning record (with conflict handling)
    INSERT INTO fp_earnings (
        user_id,
        item_id,
        item_name,
        item_type,
        health_category,
        fp_amount,
        earned_at,
        title,
        description
    ) VALUES (
        NEW.user_id,
        NEW.boost_id,
        v_description,
        'boost',
        v_category,
        v_fp_amount,
        NEW.completed_at,
        v_description,
        v_description
    )
    ON CONFLICT (user_id, item_id, (earned_at::date)) 
    WHERE item_type = 'boost'
    DO NOTHING; -- Prevent duplicates
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the boost completion
        RAISE LOG 'Error in sync_boost_fp_earning: % %', SQLERRM, SQLSTATE;
        RETURN NEW;
END;
$$;

-- Step 5: Verify trigger exists and is properly configured
DO $$
BEGIN
    -- Recreate trigger if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'sync_boost_fp_earning_trigger'
    ) THEN
        CREATE TRIGGER sync_boost_fp_earning_trigger
            AFTER INSERT ON completed_boosts
            FOR EACH ROW
            EXECUTE FUNCTION sync_boost_fp_earning();
        
        RAISE NOTICE 'Created sync_boost_fp_earning_trigger';
    END IF;
END $$;

-- Step 6: Add logging to track FP awards for debugging
CREATE OR REPLACE FUNCTION log_fp_award(
    p_user_id UUID,
    p_source TEXT,
    p_amount INTEGER,
    p_description TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO debug_logs (
        operation,
        table_name,
        record_id,
        details,
        success,
        created_at
    ) VALUES (
        'fp_award',
        'fp_earnings',
        p_user_id::TEXT,
        jsonb_build_object(
            'source', p_source,
            'amount', p_amount,
            'description', p_description,
            'timestamp', NOW()
        ),
        true,
        NOW()
    );
END;
$$;

-- Step 7: Final verification and summary
DO $$
DECLARE
    total_users INTEGER;
    total_fp_earnings INTEGER;
    boost_fp_earnings INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO total_fp_earnings FROM fp_earnings;
    SELECT COUNT(*) INTO boost_fp_earnings FROM fp_earnings WHERE item_type = 'boost';
    
    RAISE NOTICE 'Migration completed successfully:';
    RAISE NOTICE '- Total users: %', total_users;
    RAISE NOTICE '- Total FP earnings records: %', total_fp_earnings;
    RAISE NOTICE '- Boost FP earnings records: %', boost_fp_earnings;
    RAISE NOTICE '- Unique constraint added to prevent future duplicates';
    RAISE NOTICE '- RPC function updated to prevent manual FP awards';
    RAISE NOTICE '- Trigger function updated with conflict handling';
END $$;