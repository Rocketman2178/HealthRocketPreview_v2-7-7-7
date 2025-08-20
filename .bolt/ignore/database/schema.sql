/*
  # Health Rocket Database Schema
  
  Complete database schema for Health Rocket v2.7.7
  
  ## Core Tables
  1. Users and Authentication
  2. Game Mechanics (Challenges, Quests, Contests)
  3. Fuel Points System
  4. Health Tracking
  5. Social Features (Communities, Chat)
  6. Admin and Support
  
  ## Key Features
  - Unified Fuel Points system via fp_earnings table
  - Comprehensive game mechanics with challenges, quests, and contests
  - Health optimization tracking with monthly assessments
  - Community-based leaderboards and competitions
  - Real-time chat for challenges and contests
*/

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- USERS AND AUTHENTICATION
-- ============================================================================

/*
  # Users table - Core player profiles
  
  Central user table with game stats and health metrics
  Links to auth.users for authentication
*/
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  display_name TEXT,
  avatar_url TEXT,
  
  -- Game Stats
  plan TEXT DEFAULT 'Preview Access',
  plan_status TEXT DEFAULT 'Trial',
  level INTEGER DEFAULT 1,
  fuel_points INTEGER DEFAULT 0,
  lifetime_fp INTEGER DEFAULT 0,
  burn_streak INTEGER DEFAULT 0,
  longest_burn_streak INTEGER DEFAULT 0,
  days_since_fp INTEGER DEFAULT 0,
  contest_credits INTEGER DEFAULT 2,
  
  -- Health Metrics
  health_score NUMERIC(4,2) DEFAULT 7.8,
  healthspan_years NUMERIC(5,2) DEFAULT 0,
  lifespan INTEGER DEFAULT 85,
  healthspan INTEGER DEFAULT 75,
  health_assessment_available BOOLEAN DEFAULT true,
  health_assessments_completed INTEGER DEFAULT 0,
  
  -- Onboarding
  onboarding_completed BOOLEAN DEFAULT false,
  onboarding_step TEXT DEFAULT 'mission',
  
  -- Subscription
  subscription_start_date TIMESTAMPTZ,
  subscription_end_date TIMESTAMPTZ,
  
  -- Integrations
  vital_user_id TEXT,
  
  -- Preferences
  notification_preferences JSONB DEFAULT '{"sms": false, "push": true, "email": false}',
  email_opt_out BOOLEAN DEFAULT false,
  email_opt_out_date TIMESTAMPTZ,
  
  -- Admin
  is_admin BOOLEAN DEFAULT false,
  feedback BOOLEAN DEFAULT false,
  
  -- Constraints
  CONSTRAINT users_healthspan_years_positive CHECK (healthspan_years >= 0)
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT TO public USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE TO public USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT TO public WITH CHECK (auth.uid() = id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_fuel_points_level ON users USING btree (fuel_points DESC, level DESC);
CREATE INDEX IF NOT EXISTS idx_users_burn_streak ON users USING btree (burn_streak DESC) WHERE (burn_streak > 0);

-- ============================================================================
-- FUEL POINTS SYSTEM
-- ============================================================================

/*
  # FP Earnings - Unified fuel points tracking
  
  Single source of truth for all fuel points earnings
  Replaces legacy daily_fp system
*/
CREATE TABLE IF NOT EXISTS fp_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN (
    'boost', 'challenge', 'quest', 'contest', 'health_assessment',
    'device_connection', 'burn_streak_bonus', 'other', 'code', 
    'custom_challenge', 'weekly_action'
  )),
  health_category TEXT CHECK (health_category IN (
    'mindset', 'sleep', 'exercise', 'nutrition', 'biohacking', 'general'
  )),
  fp_amount INTEGER NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  title TEXT,
  description TEXT,
  user_name TEXT,
  
  -- Constraints
  CONSTRAINT valid_health_category CHECK (
    (health_category IS NULL) OR 
    (lower(health_category) = ANY (ARRAY['mindset'::text, 'sleep'::text, 'exercise'::text, 'nutrition'::text, 'biohacking'::text, 'general'::text]))
  ),
  CONSTRAINT valid_item_type CHECK (
    item_type = ANY (ARRAY['boost'::text, 'challenge'::text, 'quest'::text, 'contest'::text, 'health_assessment'::text, 'device_connection'::text, 'burn_streak_bonus'::text, 'other'::text, 'code'::text, 'custom_challenge'::text, 'weekly_action'::text])
  )
);

-- Enable RLS
ALTER TABLE fp_earnings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own FP earnings" ON fp_earnings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fp_earnings_user_id ON fp_earnings USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_fp_earnings_earned_at ON fp_earnings USING btree (earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_fp_earnings_item_type ON fp_earnings USING btree (item_type);
CREATE INDEX IF NOT EXISTS idx_fp_earnings_user_date ON fp_earnings USING btree (user_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_fp_earnings_health_category ON fp_earnings USING btree (health_category);

/*
  # Daily FP - Legacy daily summary table
  
  LEGACY SYSTEM - Being phased out in favor of fp_earnings
*/
CREATE TABLE IF NOT EXISTS daily_fp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  fp_earned INTEGER DEFAULT 0,
  boosts_completed INTEGER DEFAULT 0,
  challenges_completed INTEGER DEFAULT 0,
  quests_completed INTEGER DEFAULT 0,
  streak_bonus INTEGER DEFAULT 0,
  health_assessment_bonus INTEGER DEFAULT 0,
  source TEXT,
  source_id UUID,
  user_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE daily_fp ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own daily FP" ON daily_fp
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily FP" ON daily_fp
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily FP" ON daily_fp
  FOR UPDATE TO public USING (auth.uid() = user_id);

/*
  # Monthly FP Totals - Leaderboard rankings
  
  Powers monthly leaderboards and prize pool eligibility
*/
CREATE TABLE IF NOT EXISTS monthly_fp_totals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  total_fp INTEGER DEFAULT 0,
  rank INTEGER,
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, year, month)
);

-- Enable RLS
ALTER TABLE monthly_fp_totals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own monthly totals" ON monthly_fp_totals
  FOR SELECT TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_monthly_fp_year_month ON monthly_fp_totals USING btree (year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_fp_total_rank ON monthly_fp_totals USING btree (total_fp DESC, rank);

-- ============================================================================
-- GAME MECHANICS
-- ============================================================================

/*
  # Challenge Library - Available challenges
  
  Master list of all available challenges
*/
CREATE TABLE IF NOT EXISTS challenge_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier = ANY (ARRAY[0, 1, 2])),
  duration INTEGER DEFAULT 21 NOT NULL,
  description TEXT NOT NULL,
  expert_reference TEXT,
  learning_objectives TEXT[] DEFAULT '{}' NOT NULL,
  requirements JSONB DEFAULT '[]' NOT NULL,
  implementation_protocol JSONB,
  verification_method JSONB,
  success_metrics TEXT[] DEFAULT '{}' NOT NULL,
  expert_tips TEXT[] DEFAULT '{}' NOT NULL,
  fuel_points INTEGER DEFAULT 50 NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  version INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  daily_actions JSONB DEFAULT '[]'
);

-- Enable RLS
ALTER TABLE challenge_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active challenges" ON challenge_library
  FOR SELECT TO public USING (is_active = true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenge_library_category ON challenge_library USING btree (category) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_challenge_library_tier ON challenge_library USING btree (tier) WHERE (is_active = true);

/*
  # Quest Library - Available quests
  
  Master list of all available quests
*/
CREATE TABLE IF NOT EXISTS quest_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier = ANY (ARRAY[1, 2])),
  duration INTEGER DEFAULT 90 NOT NULL,
  description TEXT NOT NULL,
  expert_ids TEXT[] DEFAULT '{}' NOT NULL,
  challenge_ids TEXT[] DEFAULT '{}' NOT NULL,
  requirements JSONB DEFAULT '{}' NOT NULL,
  verification_methods TEXT[] DEFAULT '{}' NOT NULL,
  fuel_points INTEGER DEFAULT 150 NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  version INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  verification_type CHARACTER VARYING(20) DEFAULT 'weekly',
  weekly_actions JSONB DEFAULT '[]',
  weekly_fp_reward INTEGER DEFAULT 30,
  completion_fp_reward INTEGER DEFAULT 500
);

-- Enable RLS
ALTER TABLE quest_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active quests" ON quest_library
  FOR SELECT TO public USING (is_active = true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quest_library_category ON quest_library USING btree (category) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_quest_library_tier ON quest_library USING btree (tier) WHERE (is_active = true);

/*
  # Challenges - User's active challenges
  
  Tracks user's active challenges with detailed progress
*/
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  verifications_required INTEGER DEFAULT 3,
  verification_count INTEGER DEFAULT 0,
  verification_requirements JSONB DEFAULT jsonb_build_object(
    'week1', jsonb_build_object('required', 1, 'completed', 0, 'deadline', NULL),
    'week2', jsonb_build_object('required', 1, 'completed', 0, 'deadline', NULL),
    'week3', jsonb_build_object('required', 1, 'completed', 0, 'deadline', NULL)
  ),
  boost_count INTEGER DEFAULT 0,
  last_daily_boost_completed_date DATE,
  last_verification_update DATE,
  category TEXT,
  name TEXT,
  description TEXT,
  daily_actions JSONB DEFAULT '[]',
  quest_id TEXT,
  challenge_data JSONB DEFAULT '{}',
  user_name TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, challenge_id)
);

-- Enable RLS
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own challenges" ON challenges
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own challenges" ON challenges
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own challenges" ON challenges
  FOR UPDATE TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own challenges" ON challenges
  FOR DELETE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS challenges_user_id_idx ON challenges USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_user_status ON challenges USING btree (user_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_verification_count ON challenges USING btree (user_id, verification_count) WHERE (status = 'active');

/*
  # Quests - Long-term quest progress
  
  Tracks 90-day quests that combine multiple challenges
*/
CREATE TABLE IF NOT EXISTS quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  daily_boosts_completed INTEGER DEFAULT 0,
  user_name TEXT,
  
  UNIQUE(user_id, quest_id)
);

-- Enable RLS
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own quests" ON quests
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quests" ON quests
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own quests" ON quests
  FOR UPDATE TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own quests" ON quests
  FOR DELETE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS quests_user_id_idx ON quests USING btree (user_id);

/*
  # User Quest Weekly Progress - Quest milestone tracking
  
  Tracks weekly actions for quests
*/
CREATE TABLE IF NOT EXISTS user_quest_weekly_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_id TEXT REFERENCES quest_library(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  selected_action_index INTEGER NOT NULL,
  completed BOOLEAN DEFAULT false,
  completion_date TIMESTAMPTZ,
  fp_earned INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, quest_id, week_number)
);

-- Enable RLS
ALTER TABLE user_quest_weekly_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own weekly progress" ON user_quest_weekly_progress
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own weekly progress" ON user_quest_weekly_progress
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own weekly progress" ON user_quest_weekly_progress
  FOR UPDATE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quest_weekly_user_quest ON user_quest_weekly_progress USING btree (user_id, quest_id, week_number);

/*
  # Contests - Contest definitions
  
  Defines available contests with rules and prizes
*/
CREATE TABLE IF NOT EXISTS contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  description TEXT,
  challenge_id TEXT,
  entry_fee NUMERIC(10,2) DEFAULT 0 NOT NULL,
  min_players INTEGER,
  max_players INTEGER,
  start_date TIMESTAMPTZ NOT NULL,
  registration_end_date TIMESTAMPTZ NOT NULL,
  prize_pool NUMERIC(10,2) DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status = ANY (ARRAY['pending', 'active', 'failed', 'completed'])),
  is_free BOOLEAN DEFAULT false,
  health_category TEXT NOT NULL CHECK (health_category = ANY (ARRAY['Mindset', 'Sleep', 'Exercise', 'Nutrition', 'Biohacking'])),
  requirements JSONB,
  expert_reference TEXT,
  how_to_play JSONB,
  implementation_protocol JSONB,
  success_metrics JSONB,
  expert_tips JSONB,
  fuel_points INTEGER,
  duration INTEGER DEFAULT 30,
  requires_device BOOLEAN DEFAULT false,
  required_device TEXT,
  verifications_required INTEGER DEFAULT 3,
  community_id UUID REFERENCES communities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE contests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view contests" ON contests
  FOR SELECT TO public USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contests_challenge_id ON contests USING btree (challenge_id);
CREATE INDEX IF NOT EXISTS idx_contests_community_id ON contests USING btree (community_id);
CREATE INDEX IF NOT EXISTS idx_contests_health_category ON contests USING btree (health_category);

/*
  # Active Contests - User participation in contests
  
  Manages user participation in competitive contests
*/
CREATE TABLE IF NOT EXISTS active_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES contests(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  progress NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  verification_count INTEGER DEFAULT 0,
  verifications_required INTEGER DEFAULT 3,
  user_name TEXT,
  verification_requirements JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  start_date TIMESTAMPTZ,
  contest_name TEXT,
  contest_description TEXT,
  
  UNIQUE(user_id, challenge_id)
);

-- Enable RLS
ALTER TABLE active_contests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own active contests" ON active_contests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can update own active contests" ON active_contests
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_active_contests_user_id ON active_contests USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_active_contests_contest_id ON active_contests USING btree (contest_id);
CREATE INDEX IF NOT EXISTS idx_active_contests_challenge_id ON active_contests USING btree (challenge_id);

-- ============================================================================
-- BOOST SYSTEM
-- ============================================================================

/*
  # Completed Boosts - Daily boost tracking
  
  Tracks completed daily health boosts with 7-day cooldown
*/
CREATE TABLE IF NOT EXISTS completed_boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boost_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  completed_date DATE DEFAULT CURRENT_DATE,
  user_name TEXT,
  boost_name TEXT,
  
  UNIQUE(user_id, boost_id, completed_date)
);

-- Enable RLS
ALTER TABLE completed_boosts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own completed boosts" ON completed_boosts
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own completed boosts" ON completed_boosts
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS completed_boosts_user_date_idx ON completed_boosts USING btree (user_id, completed_date);

/*
  # Boost FP Values - Boost reward values
  
  Defines FP values for each boost
*/
CREATE TABLE IF NOT EXISTS boost_fp_values (
  boost_id TEXT PRIMARY KEY,
  fp_value INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category = ANY (ARRAY['mindset', 'sleep', 'exercise', 'nutrition', 'biohacking'])),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE boost_fp_values ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view boost values" ON boost_fp_values
  FOR SELECT TO public USING (true);

-- ============================================================================
-- COMPLETION TRACKING
-- ============================================================================

/*
  # Completed Challenges - Challenge completion records
  
  Records of completed challenges
*/
CREATE TABLE IF NOT EXISTS completed_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  user_name TEXT,
  status TEXT DEFAULT 'completed' NOT NULL,
  
  UNIQUE(user_id, challenge_id)
);

-- Enable RLS
ALTER TABLE completed_challenges ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own completed challenges" ON completed_challenges
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own completed challenges" ON completed_challenges
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_completed_challenges_user_id ON completed_challenges USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_completed_challenges_challenge_id ON completed_challenges USING btree (challenge_id);
CREATE INDEX IF NOT EXISTS idx_completed_challenges_date ON completed_challenges USING btree (completed_at DESC);

/*
  # Completed Quests - Quest completion records
  
  Records of completed quests
*/
CREATE TABLE IF NOT EXISTS completed_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  fp_earned INTEGER NOT NULL,
  challenges_completed INTEGER NOT NULL,
  boosts_completed INTEGER NOT NULL,
  status TEXT DEFAULT 'completed' NOT NULL
);

-- Enable RLS
ALTER TABLE completed_quests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own completed quests" ON completed_quests
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own completed quests" ON completed_quests
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

/*
  # Completed Contests - Contest completion records
  
  Records of completed contests
*/
CREATE TABLE IF NOT EXISTS completed_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES contests(id) ON DELETE SET NULL,
  challenge_id TEXT NOT NULL,
  verification_count INTEGER DEFAULT 0 NOT NULL,
  verifications_required INTEGER DEFAULT 8 NOT NULL,
  all_verifications_completed BOOLEAN DEFAULT false NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  name TEXT,
  description TEXT,
  category TEXT,
  fuel_points INTEGER,
  duration INTEGER,
  entry_fee NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE completed_contests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own completed contests" ON completed_contests
  FOR SELECT TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_completed_contests_user_id ON completed_contests USING btree (user_id);

-- ============================================================================
-- HEALTH TRACKING
-- ============================================================================

/*
  # Health Assessments - Comprehensive health assessments
  
  Tracks user's health optimization progress over time
*/
CREATE TABLE IF NOT EXISTS health_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  expected_lifespan INTEGER NOT NULL,
  expected_healthspan INTEGER NOT NULL,
  health_score NUMERIC(4,2) NOT NULL,
  healthspan_years NUMERIC(5,2) NOT NULL CHECK (healthspan_years >= 0),
  previous_healthspan INTEGER,
  mindset_score NUMERIC(4,2) NOT NULL,
  sleep_score NUMERIC(4,2) NOT NULL,
  exercise_score NUMERIC(4,2) NOT NULL,
  nutrition_score NUMERIC(4,2) NOT NULL,
  biohacking_score NUMERIC(4,2) NOT NULL,
  user_name TEXT,
  health_goals TEXT,
  gender TEXT -- 'Male', 'Female', 'Prefer Not To Say'
);

-- Enable RLS
ALTER TABLE health_assessments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own assessments" ON health_assessments
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assessments" ON health_assessments
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own assessments" ON health_assessments
  FOR UPDATE TO public USING (auth.uid() = user_id);

/*
  # Health Assessment History - Assessment change tracking
  
  Tracks changes between health assessments
*/
CREATE TABLE IF NOT EXISTS health_assessment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID REFERENCES health_assessments(id) ON DELETE CASCADE,
  previous_assessment_id UUID REFERENCES health_assessments(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  healthscore_change NUMERIC(4,2),
  healthspan_change NUMERIC(4,2),
  lifespan_change INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE health_assessment_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own assessment history" ON health_assessment_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

/*
  # Health Category History - Category-specific changes
  
  Tracks changes in individual health categories
*/
CREATE TABLE IF NOT EXISTS health_category_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID REFERENCES health_assessments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category = ANY (ARRAY['mindset', 'sleep', 'exercise', 'nutrition', 'biohacking'])),
  previous_score NUMERIC(4,2),
  new_score NUMERIC(4,2),
  score_change NUMERIC(4,2),
  change_percentage NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE health_category_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own category history" ON health_category_history
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM health_assessments ha
      WHERE ha.id = health_category_history.assessment_id 
      AND ha.user_id = auth.uid()
    )
  );

-- ============================================================================
-- DEVICE INTEGRATION
-- ============================================================================

/*
  # User Devices - Health device connections
  
  Manages connections to health tracking devices via Vital API
*/
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  metadata JSONB,
  device_email TEXT
);

-- Enable RLS
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "users_view_own_devices" ON user_devices
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_devices" ON user_devices
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_devices" ON user_devices
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_devices" ON user_devices
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_devices_user_provider ON user_devices USING btree (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_user_devices_provider ON user_devices USING btree (provider);
CREATE INDEX IF NOT EXISTS idx_user_devices_status ON user_devices USING btree (status);

/*
  # Health Metrics - Device-synced health data
  
  Stores health metrics from connected devices
*/
CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  date DATE NOT NULL,
  value NUMERIC NOT NULL,
  source TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, date, metric_type, source)
);

-- Enable RLS
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "users_view_own_health_metrics" ON health_metrics
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

/*
  # Lab Results - Laboratory test results
  
  Stores lab test results from health providers
*/
CREATE TABLE IF NOT EXISTS lab_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_id TEXT,
  test_type TEXT NOT NULL,
  test_date DATE NOT NULL,
  results JSONB NOT NULL,
  status TEXT DEFAULT 'processed',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "users_view_own_lab_results" ON lab_results
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================================
-- SOCIAL FEATURES
-- ============================================================================

/*
  # Communities - Player communities
  
  Organizes players into communities for competitions
*/
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  member_count INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active communities" ON communities
  FOR SELECT TO public USING (is_active = true);

/*
  # Community Memberships - User-community links
  
  Links users to their communities
*/
CREATE TABLE IF NOT EXISTS community_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT now(),
  global_leaderboard_opt_in BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{"role": "member"}',
  user_name TEXT DEFAULT '',
  
  UNIQUE(user_id, community_id)
);

-- Enable RLS
ALTER TABLE community_memberships ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own memberships" ON community_memberships
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memberships" ON community_memberships
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memberships" ON community_memberships
  FOR UPDATE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS community_memberships_user_id_idx ON community_memberships USING btree (user_id);
CREATE INDEX IF NOT EXISTS community_memberships_community_id_idx ON community_memberships USING btree (community_id);
CREATE INDEX IF NOT EXISTS idx_community_memberships_primary ON community_memberships USING btree (user_id) WHERE (is_primary = true);

/*
  # Chat Messages - Challenge/contest chat
  
  Powers chat functionality in challenges and contests
*/
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video')),
  is_verification BOOLEAN DEFAULT false,
  parent_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  reply_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  user_name TEXT DEFAULT ''
);

-- Enable RLS
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view chat messages" ON chat_messages
  FOR SELECT TO public USING (true);

CREATE POLICY "Users can insert own messages" ON chat_messages
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages" ON chat_messages
  FOR DELETE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages USING btree (chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent_id ON chat_messages USING btree (parent_message_id);

/*
  # Message Reactions - Chat message reactions
  
  Tracks user reactions to chat messages
*/
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(message_id, user_id)
);

-- Enable RLS
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view message reactions" ON message_reactions
  FOR SELECT TO public USING (true);

CREATE POLICY "Users can add their own reactions" ON message_reactions
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reactions" ON message_reactions
  FOR DELETE TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions USING btree (message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user_id ON message_reactions USING btree (user_id);

/*
  # Message Read Status - Chat read tracking
  
  Tracks user's read status for chat channels
*/
CREATE TABLE IF NOT EXISTS message_read_status (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  
  PRIMARY KEY (user_id, chat_id)
);

-- Enable RLS
ALTER TABLE message_read_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own read status" ON message_read_status
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own read status" ON message_read_status
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own read status" ON message_read_status
  FOR UPDATE TO public USING (auth.uid() = user_id);

-- ============================================================================
-- CUSTOM CHALLENGES
-- ============================================================================

/*
  # Custom Challenges - User-created challenges
  
  Allows users to create personalized challenges
*/
CREATE TABLE IF NOT EXISTS custom_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Custom Challenge',
  status TEXT DEFAULT 'active',
  completion_count INTEGER DEFAULT 0,
  daily_minimum INTEGER DEFAULT 1,
  total_completions INTEGER DEFAULT 0,
  target_completions INTEGER DEFAULT 21,
  progress NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expert_guidance TEXT,
  fp_completion_reward INTEGER,
  fp_daily_reward INTEGER,
  last_completion_date DATE,
  user_name TEXT
);

-- Enable RLS
ALTER TABLE custom_challenges ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own custom challenges" ON custom_challenges
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own custom challenges" ON custom_challenges
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own custom challenges" ON custom_challenges
  FOR UPDATE TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own custom challenges" ON custom_challenges
  FOR DELETE TO public USING (auth.uid() = user_id);

/*
  # Custom Challenge Actions - Actions for custom challenges
  
  Defines actions within custom challenges
*/
CREATE TABLE IF NOT EXISTS custom_challenge_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_challenge_id UUID REFERENCES custom_challenges(id) ON DELETE CASCADE,
  action_text TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE custom_challenge_actions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view actions for their own custom challenges" ON custom_challenge_actions
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM custom_challenges
      WHERE custom_challenges.id = custom_challenge_actions.custom_challenge_id
      AND custom_challenges.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create actions for their own custom challenges" ON custom_challenge_actions
  FOR INSERT TO public WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_challenges
      WHERE custom_challenges.id = custom_challenge_actions.custom_challenge_id
      AND custom_challenges.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update actions for their own custom challenges" ON custom_challenge_actions
  FOR UPDATE TO public USING (
    EXISTS (
      SELECT 1 FROM custom_challenges
      WHERE custom_challenges.id = custom_challenge_actions.custom_challenge_id
      AND custom_challenges.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete actions for their own custom challenges" ON custom_challenge_actions
  FOR DELETE TO public USING (
    EXISTS (
      SELECT 1 FROM custom_challenges
      WHERE custom_challenges.id = custom_challenge_actions.custom_challenge_id
      AND custom_challenges.user_id = auth.uid()
    )
  );

-- ============================================================================
-- CODES AND PROMOTIONS
-- ============================================================================

/*
  # Launch Codes - User registration codes
  
  Manages launch codes for user registration
*/
CREATE TABLE IF NOT EXISTS launch_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  max_uses INTEGER NOT NULL,
  uses_count INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  promotion TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE launch_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Enable read access for all users" ON launch_codes
  FOR SELECT TO public USING (true);

/*
  # Launch Code Usages - Track code usage
  
  Records when users use launch codes
*/
CREATE TABLE IF NOT EXISTS launch_code_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  launch_code_id UUID NOT NULL REFERENCES launch_codes(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  
  UNIQUE(user_id, launch_code_id)
);

-- Enable RLS
ALTER TABLE launch_code_usages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own code usage" ON launch_code_usages
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own code usage" ON launch_code_usages
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

/*
  # Boost Codes - FP bonus codes
  
  Manages boost codes that award fuel points
*/
CREATE TABLE IF NOT EXISTS boost_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boost_code TEXT UNIQUE NOT NULL,
  fp_amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  promotion TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE boost_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Enable read access for all users" ON boost_codes
  FOR SELECT TO public USING (true);

/*
  # Boost Code Redemptions - Track boost code usage
  
  Records when users redeem boost codes
*/
CREATE TABLE IF NOT EXISTS boost_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boost_code_id UUID NOT NULL REFERENCES boost_codes(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  fp_earned INTEGER NOT NULL,
  boost_code_name TEXT,
  user_name TEXT,
  
  UNIQUE(user_id, boost_code_id)
);

-- Enable RLS
ALTER TABLE boost_code_redemptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own redemptions" ON boost_code_redemptions
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own redemptions" ON boost_code_redemptions
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- SUBSCRIPTION AND BILLING
-- ============================================================================

/*
  # Plans - Available subscription plans
  
  Defines available subscription plans
*/
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_id TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  interval TEXT NOT NULL,
  features JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active plans" ON plans
  FOR SELECT TO public USING (is_active = true);

/*
  # Subscriptions - User subscription data
  
  Tracks user subscription status and billing
*/
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_id TEXT,
  status TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON subscriptions USING btree (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_id ON subscriptions USING btree (stripe_subscription_id);

-- ============================================================================
-- ADMIN AND SUPPORT
-- ============================================================================

/*
  # Support Messages - User support requests
  
  Manages user support and feedback messages
*/
CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  email_id TEXT
);

-- Enable RLS
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can create support messages" ON support_messages
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own support messages" ON support_messages
  FOR SELECT TO public USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_resolved ON support_messages USING btree (resolved);
CREATE INDEX IF NOT EXISTS idx_support_messages_category ON support_messages USING btree (category);

/*
  # Player Messages - Admin messages to players
  
  System messages displayed to players
*/
CREATE TABLE IF NOT EXISTS player_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  action_text TEXT DEFAULT 'Go There' NOT NULL,
  action_target TEXT NOT NULL,
  priority INTEGER DEFAULT 0 NOT NULL,
  condition_type TEXT NOT NULL,
  condition_value JSONB DEFAULT '{}' NOT NULL,
  is_admin BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE player_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active player messages" ON player_messages
  FOR SELECT TO public USING (is_active = true);

/*
  # Player Message Dismissals - Track dismissed messages
  
  Records when users dismiss player messages
*/
CREATE TABLE IF NOT EXISTS player_message_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES player_messages(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  
  UNIQUE(user_id, message_id)
);

-- Enable RLS
ALTER TABLE player_message_dismissals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own dismissals" ON player_message_dismissals
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dismissals" ON player_message_dismissals
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- ANALYTICS AND INSIGHTS
-- ============================================================================

/*
  # User Insights - Daily user analytics
  
  Daily snapshots of individual user metrics
*/
CREATE TABLE IF NOT EXISTS user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  health_score NUMERIC(4,2),
  healthspan_years NUMERIC(4,2),
  category_scores JSONB,
  fuel_points_earned INTEGER DEFAULT 0,
  burn_streak INTEGER DEFAULT 0,
  active_challenges_count INTEGER DEFAULT 0,
  active_quests_count INTEGER DEFAULT 0,
  active_contests_count INTEGER DEFAULT 0,
  chat_messages_count INTEGER DEFAULT 0,
  verification_posts_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own insights" ON user_insights
  FOR SELECT TO public USING (auth.uid() = user_id);

/*
  # All User Insights - Global analytics
  
  Daily aggregated analytics across all users
*/
CREATE TABLE IF NOT EXISTS all_user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE UNIQUE NOT NULL,
  total_users INTEGER DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  average_health_score NUMERIC(4,2),
  average_healthspan_years NUMERIC(4,2),
  total_healthspan_years NUMERIC(8,2),
  category_averages JSONB,
  total_fp_earned INTEGER DEFAULT 0,
  total_lifetime_fp INTEGER,
  average_fp_per_user NUMERIC(8,2) DEFAULT 0,
  average_level NUMERIC(4,2),
  highest_level INTEGER,
  total_boosts_completed INTEGER DEFAULT 0,
  total_lifetime_boosts INTEGER,
  total_challenges_completed INTEGER DEFAULT 0,
  total_lifetime_challenges INTEGER,
  total_quests_completed INTEGER DEFAULT 0,
  total_lifetime_quests INTEGER,
  total_contests_active INTEGER DEFAULT 0,
  total_chat_messages INTEGER DEFAULT 0,
  total_lifetime_chat_messages INTEGER,
  total_verification_posts INTEGER DEFAULT 0,
  total_lifetime_verification_posts INTEGER,
  challenge_actions INTEGER DEFAULT 0,
  contest_registrations INTEGER DEFAULT 0,
  challenge_registrations INTEGER DEFAULT 0,
  cosmo_chats INTEGER DEFAULT 0,
  contest_verifications INTEGER DEFAULT 0,
  health_assessments INTEGER DEFAULT 0,
  quest_actions INTEGER DEFAULT 0,
  device_connection_stats JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS on analytics table (admin access only)

-- ============================================================================
-- COSMO AI SYSTEM
-- ============================================================================

/*
  # Cosmo Chat Messages - AI chat history
  
  Stores chat messages with Cosmo AI assistant
*/
CREATE TABLE IF NOT EXISTS cosmo_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_user_message BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  session_id TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Enable RLS
ALTER TABLE cosmo_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own cosmo chat messages" ON cosmo_chat_messages
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cosmo chat messages" ON cosmo_chat_messages
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cosmo_chat_messages_user_id ON cosmo_chat_messages USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_cosmo_chat_messages_created_at ON cosmo_chat_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cosmo_chat_messages_session_id ON cosmo_chat_messages USING btree (session_id);

-- ============================================================================
-- PRIZE SYSTEM
-- ============================================================================

/*
  # Prize Points - Monthly prize eligibility
  
  Tracks prize points earned through monthly rankings
*/
CREATE TABLE IF NOT EXISTS prize_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  prize_slot INTEGER NOT NULL,
  prize_points INTEGER NOT NULL,
  tier TEXT NOT NULL,
  total_fp INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  award_date DATE NOT NULL,
  redemption_quarter TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE prize_points ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own prize points" ON prize_points
  FOR SELECT TO public USING (auth.uid() = user_id);

/*
  # Prize Pool Partners - Prize providers
  
  Manages partners who provide prizes
*/
CREATE TABLE IF NOT EXISTS prize_pool_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  prize_description TEXT NOT NULL,
  website_url TEXT NOT NULL,
  logo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE prize_pool_partners ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active partners" ON prize_pool_partners
  FOR SELECT TO public USING (is_active = true);

-- ============================================================================
-- UTILITY TABLES
-- ============================================================================

/*
  # App Config - Application configuration
  
  Stores application-wide configuration values
*/
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read config" ON app_config
  FOR SELECT TO authenticated USING (true);

/*
  # Level Recommendations - Level-based guidance
  
  Provides recommendations based on user level
*/
CREATE TABLE IF NOT EXISTS level_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  fp_needed INTEGER
);

-- Enable RLS
ALTER TABLE level_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active recommendations" ON level_recommendations
  FOR SELECT TO public USING (is_active = true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_level_recommendations_level ON level_recommendations USING btree (level, is_active);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

/*
  # Helper function to get current user ID
  
  Returns the authenticated user's ID
*/
CREATE OR REPLACE FUNCTION uid() 
RETURNS UUID 
LANGUAGE SQL 
STABLE
AS $$
  SELECT auth.uid();
$$;

/*
  # Helper function to check if user is admin
  
  Checks if the current user has admin privileges
*/
CREATE OR REPLACE FUNCTION is_admin() 
RETURNS BOOLEAN 
LANGUAGE SQL 
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND is_admin = true
  );
$$;

-- ============================================================================
-- SAMPLE DATA (Optional - for development)
-- ============================================================================

-- Insert default app configuration
INSERT INTO app_config (key, value, description) VALUES
  ('app_version', '2.7.7', 'Current application version'),
  ('maintenance_mode', 'false', 'Whether the app is in maintenance mode'),
  ('max_daily_boosts', '3', 'Maximum daily boosts per user'),
  ('max_active_challenges', '2', 'Maximum active challenges per user'),
  ('health_assessment_cooldown_days', '30', 'Days between health assessments')
ON CONFLICT (key) DO NOTHING;

-- Insert default communities
INSERT INTO communities (id, name, description, is_active) VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Global Community', 'The main Health Rocket community for all players', true),
  ('c4ee186a-4182-4298-a9ad-3e101e532792', 'Gobundance Emerge', 'Exclusive community for Gobundance Emerge members', true)
ON CONFLICT (id) DO NOTHING;

-- Insert sample boost FP values
INSERT INTO boost_fp_values (boost_id, fp_value, category) VALUES
  ('mindset-t1-1', 1, 'mindset'),
  ('mindset-t1-2', 2, 'mindset'),
  ('mindset-t1-3', 3, 'mindset'),
  ('sleep-t1-1', 1, 'sleep'),
  ('sleep-t1-2', 2, 'sleep'),
  ('sleep-t1-3', 3, 'sleep'),
  ('exercise-t1-1', 1, 'exercise'),
  ('exercise-t1-2', 2, 'exercise'),
  ('exercise-t1-3', 3, 'exercise'),
  ('nutrition-t1-1', 1, 'nutrition'),
  ('nutrition-t1-2', 2, 'nutrition'),
  ('nutrition-t1-3', 3, 'nutrition'),
  ('biohacking-t1-1', 1, 'biohacking'),
  ('biohacking-t1-2', 2, 'biohacking'),
  ('biohacking-t1-3', 3, 'biohacking')
ON CONFLICT (boost_id) DO NOTHING;

-- ============================================================================
-- TRIGGERS AND FUNCTIONS (Basic Setup)
-- ============================================================================

/*
  # Update timestamp trigger function
  
  Generic function to update updated_at timestamps
*/
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers to relevant tables
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monthly_fp_totals_updated_at 
  BEFORE UPDATE ON monthly_fp_totals 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_challenges_updated_at 
  BEFORE UPDATE ON challenges 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at 
  BEFORE UPDATE ON subscriptions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- NOTES
-- ============================================================================

/*
  This schema provides the foundation for Health Rocket's core functionality:
  
  1. User management with game statistics
  2. Unified fuel points system via fp_earnings
  3. Challenge, quest, and contest mechanics
  4. Health tracking and assessments
  5. Community features and chat
  6. Custom challenges
  7. Prize and reward systems
  8. Admin and support tools
  
  Additional functions, triggers, and RPC endpoints should be added
  via separate migration files as needed.
  
  For the complete function library and advanced triggers, refer to
  the SCHEMA_DOCUMENTATION.md file.
*/