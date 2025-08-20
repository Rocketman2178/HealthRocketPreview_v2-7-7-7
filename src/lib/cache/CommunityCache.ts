import { CommunityAnalytics } from '../monitoring/CommunityAnalytics';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

interface CacheConfig {
  membershipTTL: number;
  reactionsTTL: number;
  membersTTL: number;
  maxSize: number;
}

export class CommunityCache {
  private static cache = new Map<string, CacheEntry<any>>();
  private static config: CacheConfig = {
    membershipTTL: 5 * 60 * 1000, // 5 minutes
    reactionsTTL: 2 * 60 * 1000,  // 2 minutes
    membersTTL: 10 * 60 * 1000,   // 10 minutes
    maxSize: 1000
  };

  /**
   * Get cached data with analytics tracking
   */
  static get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      CommunityAnalytics.trackCache(key, false);
      return null;
    }

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      CommunityAnalytics.trackCache(key, false);
      return null;
    }

    CommunityAnalytics.trackCache(key, true);
    return entry.data;
  }

  /**
   * Set cached data with TTL
   */
  static set<T>(key: string, data: T, customTTL?: number): void {
    // Determine TTL based on key type
    let ttl = customTTL;
    if (!ttl) {
      if (key.startsWith('membership_')) {
        ttl = this.config.membershipTTL;
      } else if (key.startsWith('reactions_')) {
        ttl = this.config.reactionsTTL;
      } else if (key.startsWith('members_')) {
        ttl = this.config.membersTTL;
      } else {
        ttl = this.config.membershipTTL; // Default
      }
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + ttl
    };

    this.cache.set(key, entry);

    // Cleanup if cache is too large
    if (this.cache.size > this.config.maxSize) {
      this.cleanup();
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  static invalidate(pattern: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cache
   */
  static clear(): void {
    this.cache.clear();
  }

  /**
   * Cleanup expired entries
   */
  static cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    // If still too large, remove oldest entries
    if (this.cache.size > this.config.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, this.cache.size - this.config.maxSize);
      toRemove.forEach(([key]) => this.cache.delete(key));
    }
  }

  /**
   * Get cache statistics
   */
  static getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map(e => e.timestamp);

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: CommunityAnalytics.getCacheStats().hitRate,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null
    };
  }

  /**
   * Update cache configuration
   */
  static updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

// Auto-cleanup every 5 minutes
setInterval(() => {
  CommunityCache.cleanup();
}, 300000);