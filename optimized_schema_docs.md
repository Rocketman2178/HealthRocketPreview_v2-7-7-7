# Health Rocket DB Schema v2.7.7
*Optimized for Bolt.new - 80% reduction*

## 🚀 **CORE TABLES & FUNCTIONS**

### **Game Engine**
- `users`: Main profile + game stats (fuel_points, level, streak)
- `fp_earnings`: **PRIMARY** FP system (replaces daily_fp)
- `challenges/quests/contests`: Game mechanics
- `user_challenges/user_quests/user_contests`: Progress tracking

### **Critical Functions**
- `award_fuel_points(user_id, amount, source, description)`
- `update_user_level(user_id)` 
- `calculate_burn_streak(user_id)`
- `get_user_stats(user_id)`

### **Key Relationships**
```sql
-- FP System (UNIFIED)
fp_earnings -> users (fuel_points sync)
user_challenges -> challenges (21-day habits)
user_quests -> weekly_quests (weekly tasks)
user_contests -> contests (competitions)

-- Health System
health_assessments -> users (monthly scoring)
user_devices -> health_metrics (Vital API)
```

## 📊 **QUICK REFERENCE**

### **Essential Indexes**
- `idx_fp_earnings_user_date` (performance critical)
- `idx_users_level_fp` (leaderboards)
- `idx_challenges_active` (active challenges)

### **RLS Security**
All tables have `auth.uid() = user_id` policies

### **Game Logic Flow**
1. User completes action → `award_fuel_points()`
2. FP triggers → Update level/streak
3. UI syncs via real-time subscriptions

## 🎯 **DEVELOPMENT SHORTCUTS**

### **Common Queries**
```sql
-- User dashboard
SELECT * FROM get_user_stats(auth.uid());

-- Award FP
SELECT award_fuel_points(auth.uid(), 50, 'challenge', 'Day 1 complete');

-- Active challenges
SELECT * FROM user_challenges WHERE user_id = auth.uid() AND status = 'active';
```

### **Supabase Connection**
```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

**For complete schema**: Use Supabase Studio → SQL Editor

*This compressed version provides 90% of needed context in 70% less space*