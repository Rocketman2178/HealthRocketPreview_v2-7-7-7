import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AuthError, DatabaseError } from './errors';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function calculateGrowth(current: number, previous: number): number {
  return ((current - previous) / previous) * 100;
}

// Calculate next level points using exponential growth formula
export function calculateNextLevelPoints(level: number): number {
  // Base points needed for level 1 is 20 FP
  // Each level requires 41.4% more points than the previous level
  // Using 1.414 as the growth factor (approximately √2)
  const basePoints = 20;
  const growthFactor = 1.414;
  
  return Math.round(basePoints * Math.pow(growthFactor, level - 1));
}

// Scroll to section utility
export function scrollToSection(id: string, block: ScrollLogicalPosition = 'start') {
  const element = document.getElementById(id);
  console.log(`Scrolling to section: ${id}, element exists: ${!!element}`);
  if (element) {
    // Add a small delay to ensure any state updates have completed and UI has rendered
    // Increase the delay to ensure the DOM has fully updated
    setTimeout(() => {
      console.log(`Executing scroll to ${id}`);
      // Force a reflow before scrolling to ensure the element is properly positioned
      void element.getBoundingClientRect();
      element.scrollIntoView({ behavior: 'smooth', block });
    }, 250);
  }
}

// Calculate streak bonus FP
export function calculateStreakBonus(streak: number | undefined): number {
  if (streak === undefined) return 0;
  if (streak >= 21) return 100;  // 21+ days: 100 FP
  if (streak >= 7) return 10;    // 7-20 days: 10 FP
  if (streak >= 3) return 5;     // 3-6 days: 5 FP
  return 0;                      // 0-2 days: no bonus
}
// Calculate FP earned from boosts
// Centralized dashboard update dispatcher
export function triggerDashboardUpdate(detail?: {
  fpEarned?: number;
  updatedPart?: string;
  category?: string;
  challengeCompleted?: boolean;
  questCompleted?: boolean;
}) {
  // Dispatch single consolidated event
  window.dispatchEvent(new CustomEvent('dashboardUpdate', { detail }));
}

// Debounced version to prevent spam
let updateTimeout: NodeJS.Timeout;
export function triggerDashboardUpdateDebounced(detail?: {
  fpEarned?: number;
  updatedPart?: string;
  category?: string;
  challengeCompleted?: boolean;
  questCompleted?: boolean;
}) {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    triggerDashboardUpdate(detail);
  }, 300);
}
function calculateBoostFP(boosts: CompletedBoost[], allBoosts: any[]): number {
  return boosts.reduce((total, boost) => {
    const boostDetails = allBoosts.find(b => b.id === boost.id);
    return total + (boostDetails?.fuelPoints || 0);
  }, 0);
}

export function calculateStreakInfo(
  currentStreak: number | undefined,
  completedBoosts: CompletedBoost[],
  selectedBoostsCount: number,
  maxDailyBoosts: number,
  dailyFpEarned: number
): StreakInfo {
  // Ensure currentStreak is a number
  const streak = currentStreak || 0;
  console.log("calculateStreakInfo received streak:", streak);
  
  const availableBoosts = maxDailyBoosts - selectedBoostsCount;
  const bonusMultiplier = selectedBoostsCount;
  const today = new Date().toDateString();
  const todayBoosts = completedBoosts.filter(
    boost => new Date(boost.completedAt).toDateString() === today
  );

  // Calculate next milestone and reward
  let nextMilestone: number;
  let milestoneReward: number;

  // After hitting 21, reset milestone tracking but keep counting streak
  if (streak >= 21) {
    nextMilestone = 3;
    milestoneReward = 5;
  } else if (streak < 3) {
    nextMilestone = 3;
    milestoneReward = 5;
  } else if (streak < 7) {
    nextMilestone = 7;
    milestoneReward = 10;
  } else {
    nextMilestone = 21;
    milestoneReward = 20;
  }

  // Calculate progress to next milestone
  const progress = streak >= 21 
    ? ((streak % 3) / 3) * 100  // Progress to next 3-day milestone
    : (streak / nextMilestone) * 100;  // Progress to next regular milestone

  return {
    currentStreak: streak,
    nextMilestone,
    milestoneReward,
    progress,
    dailyBoostsCompleted: selectedBoostsCount,
    maxDailyBoosts: 3,
    availableBoosts,
    bonusMultiplier,
    dailyFpEarned
  };
}

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  shouldRetry: (error: any) => boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let retries = 0;
  let delay = options.initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      
      if (retries > options.maxRetries || !options.shouldRetry(error)) {
        throw error;
      }

      // Exponential backoff with jitter
      delay = Math.min(
        delay * (1.5 + Math.random() * 0.5),
        options.maxDelay
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}