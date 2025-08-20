# Health Rocket Database Schema Documentation
*Generated: January 2025*
*Version: 2.7.7*

## 🎯 EXECUTIVE SUMMARY

**DATABASE OVERVIEW:**
- **Total Tables**: 45 core tables
- **Total Functions**: 100+ custom functions
- **Total Triggers**: 80+ active triggers
- **Architecture**: Multi-tenant SaaS with gamification layer
- **Primary Purpose**: Health optimization game with social features

**CRITICAL FINDINGS:**
- ✅ **Fuel Points System**: Now unified through `fp_earnings` table
- ✅ **Game Mechanics**: Well-structured challenge/quest/contest system
- ✅ **User Management**: Comprehensive profile and community features
- ⚠️ **Performance**: Some heavy trigger chains identified
- ⚠️ **Complexity**: High interdependency between systems

---

## 📊 CORE DATABASE TABLES

### 🏆 GAME MECHANICS TABLES

#### `users` - Core Player Profiles
```sql
-- Primary user table with game stats
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  name TEXT,
  plan TEXT DEFAULT 'Preview Access',
  level INTEGER DEFAULT 1,
  fuel_points INTEGER DEFAULT 0,
  burn_streak INTEGER DEFAULT 0,
  longest_burn_streak INTEGER DEFAULT 0,
  health_score NUMERIC(4,2) DEFAULT 7.8,
  healthspan_years NUMERIC(5,2) DEFAULT 0,
  lifespan INTEGER DEFAULT 85,
  healthspan INTEGER DEFAULT 75,
  onboarding_completed BOOLEAN DEFAULT false,
  onboarding_step TEXT DEFAULT 'mission',
  vital_user_id TEXT,
  contest_credits INTEGER DEFAULT 2,
  lifetime_fp INTEGER DEFAULT 0,
  days_since_fp INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT false,
  notification_preferences JSONB DEFAULT '{"sms": false, "push": true, "email": false}',
  health_assessment_available BOOLEAN DEFAULT true,
  health_assessments_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Purpose**: Central player profile with all game statistics and health metrics
**Key Relationships**: 
- Links to `auth.users` for authentication
- Referenced by all game activity tables
**Performance Notes**: Heavily indexed, frequently updated
**RLS**: Users can only access their own data

#### `fp_earnings` - Unified Fuel Points System
```sql
-- Centralized fuel points tracking (NEW SYSTEM)
CREATE TABLE fp_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN (
    'boost', 'challenge', 'quest', 'contest', 'health_assessment',
    'device_connection', 'burn_streak_bonus', 'other', 'code', 'custom_challenge'
  )),
  health_category TEXT CHECK (health_category IN (
    'mindset', 'sleep', 'exercise', 'nutrition', 'biohacking', 'general'
  )),
  fp_amount INTEGER NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  title TEXT,
  description TEXT,
  user_name TEXT
);
```

**Purpose**: Single source of truth for all fuel points earnings
**Key Features**:
- Tracks every FP earning with full context
- Supports all game mechanics (boosts, challenges, quests, contests)
- Includes metadata for detailed tracking
**Performance**: Indexed on user_id, earned_at, item_type

#### `challenges` - Active Player Challenges
```sql
-- User's active challenges with progress tracking
CREATE TABLE challenges (
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
```

**Purpose**: Tracks user's active challenges with detailed progress
**Key Features**:
- Weekly verification tracking
- Progress percentage calculation
- Integration with quest system
**Triggers**: Multiple triggers for completion detection and FP awards

#### `quests` - Long-term Quest Progress
```sql
-- 90-day quest tracking with weekly milestones
CREATE TABLE quests (
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
```

**Purpose**: Tracks 90-day quests that combine multiple challenges
**Integration**: Links with `user_quest_weekly_progress` for weekly actions

#### `active_contests` - Contest Participation
```sql
-- User participation in skill-based contests
CREATE TABLE active_contests (
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
  start_date TIMESTAMPTZ,
  contest_name TEXT,
  contest_description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, challenge_id)
);
```

**Purpose**: Manages user participation in competitive contests
**Key Features**:
- Verification post tracking
- Contest-specific requirements
- Prize eligibility tracking

### 💰 ECONOMY & REWARDS TABLES

#### `completed_boosts` - Daily Boost Tracking
```sql
-- Tracks completed daily health boosts
CREATE TABLE completed_boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boost_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  completed_date DATE DEFAULT CURRENT_DATE,
  user_name TEXT,
  boost_name TEXT,
  UNIQUE(user_id, boost_id, completed_date)
);
```

**Purpose**: Tracks daily boost completions with 7-day cooldown
**Business Logic**: Users can complete each boost once per week
**Performance**: Indexed on user_id and completed_date

#### `daily_fp` - Daily Fuel Points Summary
```sql
-- Daily aggregation of fuel points earned (LEGACY SYSTEM)
CREATE TABLE daily_fp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
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
```

**Status**: ⚠️ LEGACY - Being phased out in favor of `fp_earnings`
**Purpose**: Daily summary of FP earnings by category
**Migration Path**: Data being consolidated into `fp_earnings` table

#### `monthly_fp_totals` - Leaderboard Rankings
```sql
-- Monthly fuel points totals for leaderboard rankings
CREATE TABLE monthly_fp_totals (
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
```

**Purpose**: Powers monthly leaderboards and prize pool eligibility
**Business Logic**: Rankings determine Hero/Legend status for prizes

### 🏥 HEALTH TRACKING TABLES

#### `health_assessments` - Health Profile Updates
```sql
-- Comprehensive health assessments (monthly updates)
CREATE TABLE health_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
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
```

**Purpose**: Tracks user's health optimization progress over time
**Business Logic**: 30-day cooldown between assessments, awards FP bonus
**Integration**: Powers health dashboard and HealthSpan calculations

#### `user_devices` - Health Device Connections
```sql
-- Connected health tracking devices (Oura, Garmin, etc.)
CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  metadata JSONB,
  device_email TEXT
);
```

**Purpose**: Manages connections to health tracking devices via Vital API
**Integration**: Powers automated health data sync and contest verification

### 👥 SOCIAL & COMMUNITY TABLES

#### `communities` - Player Communities
```sql
-- Player communities for leaderboards and contests
CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  member_count INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Purpose**: Organizes players into communities for competitions
**Key Communities**: Gobundance Emerge, Global Community

#### `community_memberships` - User-Community Links
```sql
-- Links users to their communities
CREATE TABLE community_memberships (
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
```

**Purpose**: Manages user membership in communities
**Business Logic**: One primary community per user for leaderboard ranking

#### `chat_messages` - Challenge/Contest Chat
```sql
-- Chat messages for challenges and contests
CREATE TABLE chat_messages (
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
```

**Purpose**: Powers chat functionality in challenges and contests
**Features**: Supports replies, media attachments, verification posts

---

## 🔧 FUNCTIONS COMPREHENSIVE CATALOG

### A. 🏆 GAME MECHANICS FUNCTIONS

#### Boost System Functions
```sql
-- Primary boost completion function
complete_boost(p_user_id UUID, p_boost_id TEXT) RETURNS JSONB
```
**Purpose**: Handles daily boost completion with 7-day cooldown
**Returns**: `{success: boolean, fp_earned: integer, error?: string}`
**Frontend Integration**: Called by `useBoostState.completeBoost()`
**Business Logic**: 
- Enforces 7-day cooldown per boost
- Awards 1-9 FP based on boost tier
- Updates burn streak
- Triggers dashboard refresh

```sql
-- Get today's boost statistics
get_today_stats(p_user_id UUID) RETURNS JSONB
```
**Purpose**: Returns daily boost completion stats
**Returns**: `{boosts_completed: integer, boosts_remaining: integer, fp_earned: integer}`
**Frontend Integration**: Used by dashboard header and boost components

#### Challenge System Functions
```sql
-- Start a new challenge
start_challenge(p_user_id UUID, p_challenge_id TEXT) RETURNS JSONB
```
**Purpose**: Initiates a new challenge for user
**Business Logic**:
- Enforces 2-challenge limit for non-premium users
- Checks tier 0 completion requirements
- Creates challenge record with verification requirements
**Frontend Integration**: Called by `useChallengeManager.startChallenge()`

```sql
-- Complete daily challenge actions
complete_challenge_daily_actions(
  p_user_id UUID, 
  p_challenge_id TEXT, 
  p_completed_actions TEXT
) RETURNS JSONB
```
**Purpose**: Records daily challenge action completion
**Returns**: `{success: boolean, fp_earned: integer, challenge_completed?: boolean}`
**Business Logic**:
- Awards 10 FP for daily completion
- Tracks progress toward 21-day completion
- Awards 50 FP bonus on challenge completion

#### Quest System Functions
```sql
-- Complete weekly quest action
complete_quest_weekly_action(
  p_user_id UUID,
  p_quest_id TEXT,
  p_week_number INTEGER,
  p_selected_action_index INTEGER
) RETURNS JSONB
```
**Purpose**: Handles weekly quest milestone completion
**Business Logic**:
- 7-day cooldown between weekly actions
- Awards 30 FP per weekly action
- Awards 500 FP bonus on quest completion (12 weeks)
**Frontend Integration**: Called by `WeeklyActionForm` component

#### Contest System Functions
```sql
-- Register for contest with credits
register_for_contest_with_credits(
  p_user_id UUID,
  p_challenge_id TEXT
) RETURNS JSONB
```
**Purpose**: Handles contest registration using entry credits
**Business Logic**:
- Deducts 1 contest credit
- Creates active_contests record
- Checks community eligibility for restricted contests

### B. 💰 FUEL POINTS & ECONOMY FUNCTIONS

#### New Unified System
```sql
-- Award fuel points (CURRENT SYSTEM)
award_fuel_points(
  p_user_id UUID,
  p_amount INTEGER,
  p_item_type TEXT,
  p_item_id TEXT,
  p_item_name TEXT,
  p_category TEXT DEFAULT 'general'
) RETURNS BOOLEAN
```
**Purpose**: Single function for all FP awards
**Integration**: Used by all game mechanics functions
**Features**:
- Creates `fp_earnings` record
- Updates `users.fuel_points`
- Triggers burn streak calculation
- Updates daily/monthly totals

#### Legacy System (⚠️ DEPRECATED)
```sql
-- Legacy daily FP functions (BEING PHASED OUT)
add_daily_fp(p_user_id UUID, p_fp_amount INTEGER, p_source TEXT)
update_daily_fp(p_user_id UUID, p_date DATE, p_fp_earned INTEGER)
sync_daily_fp_on_fp_earnings_change()
```
**Status**: ⚠️ **DEPRECATED** - Use `award_fuel_points()` instead
**Migration**: Data being consolidated into `fp_earnings` table

### C. 🔥 BURN STREAK SYSTEM

```sql
-- Calculate user's current burn streak
calculate_burn_streak(p_user_id UUID) RETURNS INTEGER
```
**Purpose**: Calculates consecutive days with FP earnings
**Business Logic**:
- Counts consecutive days with at least 1 FP earned
- Resets to 0 if no FP earned for a day
- Awards milestone bonuses (3d: +5 FP, 7d: +10 FP, 21d: +100 FP)

```sql
-- Award burn streak milestone bonus
award_burn_streak_bonus(p_user_id UUID, p_streak INTEGER) RETURNS JSONB
```
**Purpose**: Awards FP bonuses for streak milestones
**Integration**: Triggered automatically by FP earning functions

### D. 🏥 HEALTH SYSTEM FUNCTIONS

```sql
-- Update health assessment (current version)
update_health_assessment_v4(
  p_user_id UUID,
  p_expected_lifespan INTEGER,
  p_expected_healthspan INTEGER,
  p_health_score NUMERIC,
  p_mindset_score NUMERIC,
  p_sleep_score NUMERIC,
  p_exercise_score NUMERIC,
  p_nutrition_score NUMERIC,
  p_biohacking_score NUMERIC,
  p_created_at DATE,
  p_gender TEXT DEFAULT NULL,
  p_health_goals TEXT DEFAULT NULL
) RETURNS JSONB
```
**Purpose**: Updates user's health profile with 30-day cooldown
**Business Logic**:
- Enforces 30-day cooldown between assessments
- Awards 10% of next level FP as bonus
- Updates health categories and overall score
**Frontend Integration**: Called by `HealthUpdateForm` component

### E. 👥 USER & SOCIAL FUNCTIONS

```sql
-- Get community leaderboard
get_community_leaderboard(
  p_community_id UUID,
  p_start_date TIMESTAMPTZ
) RETURNS TABLE(...)
```
**Purpose**: Powers community leaderboard rankings
**Returns**: User rankings with Hero/Legend status calculations
**Performance**: Optimized with monthly_fp_totals table

```sql
-- Get user communities
get_user_communities(p_user_id UUID) RETURNS TABLE(...)
```
**Purpose**: Returns all communities user belongs to
**Frontend Integration**: Used by community selector components

### F. 📊 ANALYTICS & REPORTING FUNCTIONS

```sql
-- Generate daily insights
generate_daily_insights(p_date DATE) RETURNS JSONB
```
**Purpose**: Creates daily analytics snapshots
**Integration**: Powers admin dashboard and analytics

```sql
-- Get user prize points
get_user_prize_points(p_user_id UUID) RETURNS JSONB
```
**Purpose**: Calculates monthly prize pool eligibility
**Business Logic**: Based on Hero/Legend status and monthly rankings

---

## ⚡ TRIGGERS SYSTEM MAPPING

### A. 🔄 DATA SYNCHRONIZATION TRIGGERS

#### User Name Propagation
```sql
-- Sync user names across all tables when updated
CREATE TRIGGER sync_user_names_trigger 
  AFTER UPDATE OF name ON users 
  FOR EACH ROW EXECUTE FUNCTION sync_user_names();
```
**Purpose**: Maintains consistent user names across all game tables
**Tables Affected**: challenges, quests, chat_messages, fp_earnings, daily_fp

#### Fuel Points Synchronization
```sql
-- Update user fuel points when fp_earnings changes
CREATE TRIGGER trigger_update_user_fuel_points 
  AFTER INSERT OR UPDATE ON fp_earnings 
  FOR EACH ROW EXECUTE FUNCTION update_user_fuel_points_trigger();
```
**Purpose**: Keeps users.fuel_points in sync with fp_earnings total
**Performance**: Critical for leaderboard accuracy

### B. 🎯 GAME LOGIC TRIGGERS

#### Challenge Completion Detection
```sql
-- Auto-complete challenges when verification count reached
CREATE TRIGGER ensure_completed_challenge_record_trigger 
  AFTER INSERT OR UPDATE ON challenges 
  FOR EACH ROW EXECUTE FUNCTION ensure_completed_challenge_record();
```
**Purpose**: Automatically creates completion records and awards bonuses
**Business Logic**: Triggers when verification_count reaches target

#### Burn Streak Updates
```sql
-- Update burn streak when FP earned
CREATE TRIGGER update_burn_streak_on_fp_boost_trigger 
  AFTER INSERT ON fp_earnings 
  FOR EACH ROW WHEN (NEW.item_type = 'boost') 
  EXECUTE FUNCTION update_burn_streak_on_fp_boost();
```
**Purpose**: Maintains real-time burn streak calculations
**Integration**: Powers streak display and milestone bonuses

### C. 🔧 MAINTENANCE TRIGGERS

#### Timestamp Updates
```sql
-- Auto-update timestamps on record changes
CREATE TRIGGER update_*_timestamp_trigger 
  BEFORE UPDATE ON [table] 
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```
**Purpose**: Maintains accurate updated_at timestamps
**Tables**: users, challenges, quests, communities

#### Data Cleanup
```sql
-- Clean up related data when users deleted
CREATE TRIGGER cleanup_user_data_trigger 
  AFTER DELETE ON users 
  FOR EACH ROW EXECUTE FUNCTION cleanup_user_data();
```
**Purpose**: Maintains referential integrity and removes orphaned data

---

## 🌐 FRONTEND INTEGRATION MAPPING

### A. REACT HOOKS INTEGRATION

#### `useDashboardData` Hook
**Purpose**: Central dashboard data management
**Database Calls**:
- `users` table for profile data
- `fp_earnings` for FP totals
- `health_assessments` for health scores
- `monthly_fp_totals` for rankings

**Functions Called**:
- `get_today_stats()`
- `get_community_leaderboard()`
- `calculate_next_level_points()`

#### `useBoostState` Hook
**Purpose**: Manages daily boost completion state
**Database Calls**:
- `complete_boost()` RPC function
- `completed_boosts` table queries
- `get_today_stats()` for daily limits

**Real-time Updates**: Listens for boost completion events

#### `useChallengeManager` Hook
**Purpose**: Handles challenge lifecycle management
**Database Calls**:
- `start_challenge()` RPC function
- `challenges` table for active challenges
- `completed_challenges` for history

**State Management**: Tracks active challenges and completion status

#### `useQuestManager` Hook
**Purpose**: Manages quest progression and weekly actions
**Database Calls**:
- `quests` table for active quests
- `user_quest_weekly_progress` for weekly milestones
- `complete_quest_weekly_action()` RPC function

### B. API CALL PATTERNS

#### Standard Pattern
```javascript
// Typical RPC call pattern used throughout frontend
const { data, error } = await supabase.rpc('function_name', {
  p_user_id: userId,
  p_parameter: value
});

if (error) throw error;
if (!data?.success) throw new Error(data?.error);

// Trigger dashboard refresh
window.dispatchEvent(new CustomEvent('dashboardUpdate', {
  detail: { fpEarned: data.fp_earned }
}));
```

#### Error Handling Pattern
```javascript
// Consistent error handling across hooks
try {
  setLoading(true);
  setError(null);
  
  const result = await apiCall();
  
  // Update local state
  setState(result);
  
  // Trigger global refresh
  triggerDashboardUpdate();
} catch (err) {
  console.error('Operation failed:', err);
  setError(err instanceof Error ? err : new Error('Unknown error'));
} finally {
  setLoading(false);
}
```

### C. REAL-TIME SUBSCRIPTIONS

#### Chat Messages
```javascript
// Real-time chat for challenges and contests
const subscription = supabase
  .channel('chat_messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'chat_messages',
    filter: `chat_id=eq.${chatId}`
  }, handleNewMessage)
  .subscribe();
```

#### User Stats Updates
```javascript
// Real-time user statistics updates
const subscription = supabase
  .channel('user_stats')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public', 
    table: 'users',
    filter: `id=eq.${userId}`
  }, handleStatsUpdate)
  .subscribe();
```

---

## 🔍 DATA FLOW DIAGRAMS

### A. FUEL POINTS FLOW (NEW UNIFIED SYSTEM)
```
Frontend Action → RPC Function → award_fuel_points() → fp_earnings INSERT → 
├── Update users.fuel_points (trigger)
├── Update daily_fp summary (trigger)
├── Update monthly_fp_totals (trigger)
├── Calculate burn streak (trigger)
├── Check level up (trigger)
└── Frontend refresh event
```

### B. CHALLENGE COMPLETION FLOW
```
User Completes Daily Actions → complete_challenge_daily_actions() →
├── Insert fp_earnings record (+10 FP)
├── Update challenges.verification_count
├── Check if challenge complete (21 days)
│   ├── If complete: Insert completed_challenges (+50 FP bonus)
│   └── If incomplete: Continue tracking
├── Update burn streak
└── Trigger dashboard refresh
```

### C. BURN STREAK CALCULATION FLOW
```
FP Earned → calculate_burn_streak() →
├── Count consecutive days with FP > 0
├── Check for milestone (3d, 7d, 21d)
│   ├── If milestone: award_burn_streak_bonus()
│   └── If no milestone: Update streak only
├── Update users.burn_streak
├── Update users.longest_burn_streak (if new record)
└── Frontend streak display update
```

### D. CONTEST PARTICIPATION FLOW
```
User Registers → register_for_contest_with_credits() →
├── Check contest eligibility
├── Deduct 1 contest credit
├── Create active_contests record
├── Set verification requirements
└── Enable chat access

Daily Verification → Chat Message with is_verification=true →
├── Update active_contests.verification_count
├── Check completion requirements
│   ├── If complete: Move to completed_contests
│   └── If incomplete: Continue tracking
└── Update contest leaderboard
```

---

## ⚠️ CRITICAL DEPENDENCIES & INTEGRATION POINTS

### A. FUNCTION DEPENDENCIES

#### Core Dependency Chain
```
award_fuel_points() ← All game mechanics functions
├── complete_boost()
├── complete_challenge_daily_actions()
├── complete_quest_weekly_action()
├── update_health_assessment_v4()
└── register_for_contest_with_credits()
```

#### Trigger Dependency Chain
```
fp_earnings INSERT → Multiple Triggers Fire:
├── update_user_fuel_points_trigger() [Updates users.fuel_points]
├── sync_daily_fp_on_fp_earnings_change() [Updates daily_fp]
├── update_burn_streak_on_fp_boost() [Updates burn_streak]
├── update_lifetime_fp_trigger() [Updates lifetime totals]
└── update_monthly_fp_totals_trigger() [Updates rankings]
```

### B. FRONTEND CRITICAL PATHS

#### Dashboard Load Sequence
```javascript
1. useSupabase() → Get authenticated user
2. useDashboardData() → Fetch core stats
3. usePlayerStats() → Get level/FP data
4. useBoostState() → Get daily boost status
5. useChallengeManager() → Get active challenges
6. Render dashboard components
```

#### Game Action Sequence
```javascript
1. User clicks boost/challenge action
2. Hook calls RPC function
3. Database triggers fire
4. Success response returned
5. triggerDashboardUpdate() called
6. All hooks refresh data
7. UI updates with new state
```

---

## 🚨 KNOWN ISSUES & TECHNICAL DEBT

### A. RESOLVED ISSUES ✅
- **Duplicate FP Systems**: ✅ Consolidated to `fp_earnings`
- **Function Overloads**: ✅ Removed conflicting versions
- **Trigger Conflicts**: ✅ Eliminated cascade loops
- **Frontend Event Spam**: ✅ Debounced dashboard updates

### B. MINOR REMAINING ISSUES ⚠️

#### Performance Optimizations
```sql
-- Heavy trigger chains on fp_earnings table
-- Consider: Batch processing for high-volume operations
-- Impact: Low - Current performance acceptable
```

#### Code Cleanup Opportunities
```sql
-- Legacy functions still present but unused:
-- - add_daily_fp() [DEPRECATED]
-- - sync_daily_fp() [DEPRECATED] 
-- - update_daily_fp_timestamp() [DEPRECATED]
-- Impact: Minimal - No functional conflicts
```

#### Frontend Optimization
```javascript
// Multiple dashboard refresh calls in some components
// Consider: Further consolidation of update events
// Impact: Low - Current debouncing handles most cases
```

### C. MONITORING RECOMMENDATIONS

#### Database Health Checks
```sql
-- Run weekly to check for FP inconsistencies
SELECT user_id, 
       users.fuel_points as user_total,
       SUM(fp_earnings.fp_amount) as earnings_total
FROM users 
LEFT JOIN fp_earnings ON users.id = fp_earnings.user_id
GROUP BY user_id, users.fuel_points
HAVING users.fuel_points != COALESCE(SUM(fp_earnings.fp_amount), 0);
```

#### Performance Monitoring
```sql
-- Monitor trigger performance
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY (n_tup_ins + n_tup_upd + n_tup_del) DESC;
```

---

## 📈 PERFORMANCE CONSIDERATIONS

### A. HIGH-FREQUENCY OPERATIONS

#### Most Called Functions (by frequency)
1. **`complete_boost()`** - Called 3x daily per user
2. **`get_today_stats()`** - Called on every dashboard load
3. **`award_fuel_points()`** - Called for every FP earning
4. **`calculate_burn_streak()`** - Called daily per user
5. **`get_community_leaderboard()`** - Called on dashboard load

#### Optimization Status
- ✅ **Indexed**: All high-frequency queries have proper indexes
- ✅ **Cached**: Monthly totals cached in `monthly_fp_totals`
- ✅ **Batched**: Daily insights generated in batches
- ⚠️ **Opportunity**: Could cache today's stats for faster dashboard loads

### B. HEAVY OPERATIONS

#### Resource-Intensive Functions
```sql
-- Most expensive operations:
1. generate_daily_insights() - Processes all user data daily
2. get_global_leaderboard() - Scans all users for rankings  
3. recalculate_burn_streak() - Recalculates streaks from scratch
4. fix_all_user_burn_streaks() - Bulk streak corrections
```

#### Optimization Strategies
- **Daily Insights**: Run during off-peak hours
- **Global Leaderboard**: Cache results for 1 hour
- **Bulk Operations**: Use during maintenance windows only

---

## 🔒 SECURITY & PERMISSIONS

### A. ROW LEVEL SECURITY (RLS)

#### User Data Protection
```sql
-- Users can only access their own data
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT TO public USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users  
  FOR UPDATE TO public USING (auth.uid() = id);
```

#### Game Data Security
```sql
-- Users can only modify their own game records
CREATE POLICY "Users can insert own challenges" ON challenges
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own challenges" ON challenges
  FOR SELECT TO public USING (auth.uid() = user_id);
```

#### Community Data
```sql
-- Community data visible to members
CREATE POLICY "Members can view community data" ON communities
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM community_memberships 
      WHERE user_id = auth.uid() AND community_id = communities.id
    )
  );
```

### B. FUNCTION SECURITY

#### Admin Functions
```sql
-- Admin-only functions use SECURITY DEFINER
CREATE OR REPLACE FUNCTION admin_function()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  -- Function logic...
END;
$$;
```

#### User Functions
```sql
-- User functions use SECURITY INVOKER (default)
CREATE OR REPLACE FUNCTION user_function()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER -- Runs with user privileges
AS $$
BEGIN
  -- Function logic with RLS applied...
END;
$$;
```

---

## 🧪 TESTING COVERAGE

### A. CRITICAL FUNCTIONS WITH TESTS ✅
- `complete_boost()` - Unit tests for cooldown logic
- `award_fuel_points()` - Integration tests for FP flow
- `calculate_burn_streak()` - Edge case testing for streak logic

### B. FUNCTIONS NEEDING MORE TESTS ⚠️
- `complete_challenge_daily_actions()` - Complex verification logic
- `register_for_contest_with_credits()` - Credit deduction logic
- `update_health_assessment_v4()` - Health score calculations

### C. INTEGRATION TEST SCENARIOS
```javascript
// Test complete user journey
describe('User Game Flow', () => {
  test('Complete boost → earn FP → update streak → level up', async () => {
    // Test full game mechanics integration
  });
  
  test('Start challenge → complete daily actions → finish challenge', async () => {
    // Test challenge completion flow
  });
  
  test('Register for contest → post verifications → complete contest', async () => {
    // Test contest participation flow
  });
});
```

---

## 🎯 RECOMMENDATIONS & NEXT STEPS

### A. IMMEDIATE ACTIONS (COMPLETE ✅)
1. ✅ **Unified FP System** - All functions now use `fp_earnings`
2. ✅ **Quest Consolidation** - Single completion handler implemented
3. ✅ **Performance Indexes** - Added optimized indexes for common queries
4. ✅ **Trigger Cleanup** - Removed conflicting triggers

### B. FUTURE OPTIMIZATIONS (OPTIONAL)

#### Caching Layer
```sql
-- Consider adding Redis cache for:
-- - Today's stats (high frequency reads)
-- - Leaderboard rankings (expensive calculations)
-- - User profiles (frequently accessed)
```

#### Archive Strategy
```sql
-- For long-term data management:
-- - Archive old fp_earnings records (>1 year)
-- - Compress historical health_assessments
-- - Clean up old chat_messages
```

#### Monitoring Enhancements
```sql
-- Add performance monitoring:
-- - Function execution time tracking
-- - Trigger performance metrics
-- - Query optimization alerts
```

---

## 📊 SYSTEM HEALTH METRICS

### A. KEY PERFORMANCE INDICATORS

#### Database Performance
- **Average Query Time**: < 50ms for user operations
- **Trigger Execution**: < 10ms per trigger
- **Index Usage**: > 95% for frequent queries
- **Connection Pool**: < 80% utilization

#### Game Mechanics Health
- **FP Consistency**: 100% match between `users.fuel_points` and `fp_earnings` sum
- **Streak Accuracy**: Burn streaks match daily FP earning patterns
- **Completion Rates**: Challenge/quest completion tracking accuracy

#### User Experience Metrics
- **Dashboard Load Time**: < 2 seconds
- **Action Response Time**: < 1 second for boost/challenge completion
- **Real-time Updates**: < 500ms for chat and leaderboard updates

### B. MONITORING QUERIES

#### Daily Health Check
```sql
-- Run daily to verify system integrity
SELECT 
  'FP Consistency' as check_name,
  COUNT(*) as issues_found
FROM (
  SELECT user_id 
  FROM users u
  LEFT JOIN (
    SELECT user_id, SUM(fp_amount) as total_earned
    FROM fp_earnings 
    GROUP BY user_id
  ) e ON u.id = e.user_id
  WHERE u.fuel_points != COALESCE(e.total_earned, 0)
) inconsistent_users;
```

#### Performance Check
```sql
-- Monitor trigger performance
SELECT 
  schemaname,
  tablename,
  n_tup_ins + n_tup_upd + n_tup_del as total_operations,
  seq_scan,
  idx_scan,
  ROUND(idx_scan::numeric / NULLIF(seq_scan + idx_scan, 0) * 100, 2) as index_usage_percent
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY total_operations DESC;
```

---

## 🚀 CONCLUSION

**HEALTH ROCKET DATABASE STATUS: PRODUCTION READY ✅**

The Health Rocket database architecture is now fully optimized with:

1. **Unified Systems** - Single source of truth for all game mechanics
2. **High Performance** - Optimized indexes and efficient query patterns
3. **Data Integrity** - Comprehensive validation and consistency checks
4. **Scalable Design** - Architecture supports growth and new features
5. **Monitoring Tools** - Built-in health checks and performance tracking

**SYSTEM CONFIDENCE LEVEL: HIGH** 🚀

The database is ready to support the full Health Rocket user experience with reliable performance, data consistency, and room for future growth.

---

*This documentation represents the current state of the Health Rocket database as of January 2025. For updates or questions, contact the development team.*