import { Brain, Moon, Activity, Apple, Database } from 'lucide-react';
import { mindsetBoosts } from './boosts/mindsetBoosts';
import { sleepBoosts } from './boosts/sleepBoosts';
import { exerciseBoosts } from './boosts/exerciseBoosts';
import { nutritionBoosts } from './boosts/nutritionBoosts';
import { biohackingBoosts } from './boosts/biohackingBoosts';
import type { BoostCategory } from '../types/dashboard';

// EXPORT ALL BOOSTS FOR CALCULATION
export const allBoosts = [
  ...mindsetBoosts,
  ...sleepBoosts,
  ...exerciseBoosts,
  ...nutritionBoosts,
  ...biohackingBoosts
];

export const boostCategories: BoostCategory[] = [
  {
    name: 'Mindset',
    icon: Brain,
    boosts: mindsetBoosts,
    maxDailyBoosts: 3
  },
  {
    name: 'Sleep',
    icon: Moon,
    boosts: sleepBoosts,
    maxDailyBoosts: 3
  },
  {
    name: 'Exercise',
    icon: Activity,
    boosts: exerciseBoosts,
    maxDailyBoosts: 3
  },
  {
    name: 'Nutrition',
    icon: Apple,
    boosts: nutritionBoosts,
    maxDailyBoosts: 3
  },
  {
    name: 'Biohacking',
    icon: Database,
    boosts: biohackingBoosts,
    maxDailyBoosts: 3
  }
];