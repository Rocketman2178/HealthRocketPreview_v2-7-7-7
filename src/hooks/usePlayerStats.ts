import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { calculateNextLevelPoints } from '../lib/utils';

interface PlayerStats {
  level: number;
  fuelPoints: number;
  burnStreak: number;
  nextLevelPoints: number;
}

const DEFAULT_STATS: PlayerStats = {
  level: 1,
  fuelPoints: 0,
  burnStreak: 0,
  nextLevelPoints: 20 // Default for level 1
};

export function usePlayerStats(user: User | null) {
  const [stats, setStats] = useState<PlayerStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);

  const fetchStats = async () => {
    try {
      if (!user) {
        setStats(DEFAULT_STATS);
        setLoading(false);
        return;
      }

      // Get user stats first
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('level, fuel_points, burn_streak')
        .eq('id', user.id)
        .maybeSingle();

      if (userError && userError.code !== 'PGRST116') throw userError;
      
      // If no user data found, use default values
      if (!userData) {
        setStats(DEFAULT_STATS);
        setLoading(false);
        return;
      }

      // Calculate next level points directly
      const level = userData?.level || 1;
      const nextLevelPoints = calculateNextLevelPoints(level);

      // Use user data or defaults
      const totalFP = userData?.fuel_points || 0;

      const newStats = {
        level,
        fuelPoints: totalFP,
        burnStreak: userData?.burn_streak || 0,
        nextLevelPoints: nextLevelPoints
      };
      
      setStats(newStats);
      setError(null);
    } catch (err) {
      console.error('Error fetching player stats:', err);
      setError(err as Error);
      setStats(DEFAULT_STATS);
    } finally {
      setLoading(false);
    }
  };

  const refreshStats = async () => {
    setLoading(true);
    return await fetchStats();
  };

  useEffect(() => {
    if (user?.id) {
      fetchStats();
    }
  }, [user]);

  // Check if user has enough FP to level up and trigger level up automatically
  useEffect(() => {
    const checkLevelUp = async () => {
      if (!user || stats.fuelPoints < stats.nextLevelPoints) return;
      
      try {
        // Call the level up function
        const { data, error } = await supabase.rpc('handle_level_up', {
          p_user_id: user.id,
          p_current_fp: stats.fuelPoints
        });
        
        if (error) throw error;
        
        // Show celebration modal if level actually changed
        if (data?.level_changed) {
          setShowLevelUpModal(true);
        }
        
        // Trigger dashboard refresh
        window.dispatchEvent(new CustomEvent('dashboardUpdate'));
      } catch (err) {
        console.error('Error leveling up:', err);
      }
    };
    
    checkLevelUp();
  }, [user, stats.fuelPoints, stats.nextLevelPoints, setShowLevelUpModal]);

  return {
    stats,
    loading,
    error,
    showLevelUpModal,
    setShowLevelUpModal,
    refreshStats,
  };
}