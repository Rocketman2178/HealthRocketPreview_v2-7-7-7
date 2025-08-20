interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: number;
  userId?: string;
  communityId?: string;
}

interface CacheMetric {
  key: string;
  hit: boolean;
  timestamp: number;
}

interface EngagementMetric {
  type: 'message_sent' | 'reaction_added' | 'member_viewed' | 'chat_opened';
  communityId: string;
  userId: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class CommunityAnalytics {
  private static performanceMetrics: PerformanceMetric[] = [];
  private static cacheMetrics: CacheMetric[] = [];
  private static engagementMetrics: EngagementMetric[] = [];
  private static maxMetrics = 1000; // Keep last 1000 metrics in memory

  /**
   * Track Edge Function performance
   */
  static trackPerformance(
    operation: string,
    startTime: number,
    success: boolean,
    error?: string,
    userId?: string,
    communityId?: string
  ): void {
    const metric: PerformanceMetric = {
      operation,
      duration: Date.now() - startTime,
      success,
      error,
      timestamp: Date.now(),
      userId,
      communityId
    };

    this.performanceMetrics.push(metric);
    
    // Keep only recent metrics
    if (this.performanceMetrics.length > this.maxMetrics) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetrics);
    }

    // Log slow operations (>2 seconds)
    if (metric.duration > 2000) {
      console.warn(`Slow community operation: ${operation} took ${metric.duration}ms`, {
        operation,
        duration: metric.duration,
        success,
        error,
        communityId
      });
    }

    // Log errors
    if (!success && error) {
      console.error(`Community operation failed: ${operation}`, {
        operation,
        error,
        duration: metric.duration,
        communityId
      });
    }
  }

  /**
   * Track cache performance
   */
  static trackCache(key: string, hit: boolean): void {
    const metric: CacheMetric = {
      key,
      hit,
      timestamp: Date.now()
    };

    this.cacheMetrics.push(metric);
    
    // Keep only recent metrics
    if (this.cacheMetrics.length > this.maxMetrics) {
      this.cacheMetrics = this.cacheMetrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Track user engagement
   */
  static trackEngagement(
    type: EngagementMetric['type'],
    communityId: string,
    userId: string,
    metadata?: Record<string, any>
  ): void {
    const metric: EngagementMetric = {
      type,
      communityId,
      userId,
      timestamp: Date.now(),
      metadata
    };

    this.engagementMetrics.push(metric);
    
    // Keep only recent metrics
    if (this.engagementMetrics.length > this.maxMetrics) {
      this.engagementMetrics = this.engagementMetrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Get performance statistics
   */
  static getPerformanceStats(timeWindow: number = 300000): {
    totalOperations: number;
    successRate: number;
    averageDuration: number;
    slowOperations: number;
    errorRate: number;
    operationBreakdown: Record<string, { count: number; avgDuration: number; successRate: number }>;
  } {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.performanceMetrics.filter(m => m.timestamp > cutoff);

    if (recentMetrics.length === 0) {
      return {
        totalOperations: 0,
        successRate: 100,
        averageDuration: 0,
        slowOperations: 0,
        errorRate: 0,
        operationBreakdown: {}
      };
    }

    const totalOperations = recentMetrics.length;
    const successfulOperations = recentMetrics.filter(m => m.success).length;
    const totalDuration = recentMetrics.reduce((sum, m) => sum + m.duration, 0);
    const slowOperations = recentMetrics.filter(m => m.duration > 2000).length;

    // Operation breakdown
    const operationBreakdown: Record<string, { count: number; avgDuration: number; successRate: number }> = {};
    
    recentMetrics.forEach(metric => {
      if (!operationBreakdown[metric.operation]) {
        operationBreakdown[metric.operation] = { count: 0, avgDuration: 0, successRate: 0 };
      }
      operationBreakdown[metric.operation].count++;
    });

    Object.keys(operationBreakdown).forEach(operation => {
      const opMetrics = recentMetrics.filter(m => m.operation === operation);
      const opSuccessful = opMetrics.filter(m => m.success).length;
      const opTotalDuration = opMetrics.reduce((sum, m) => sum + m.duration, 0);
      
      operationBreakdown[operation].avgDuration = opTotalDuration / opMetrics.length;
      operationBreakdown[operation].successRate = (opSuccessful / opMetrics.length) * 100;
    });

    return {
      totalOperations,
      successRate: (successfulOperations / totalOperations) * 100,
      averageDuration: totalDuration / totalOperations,
      slowOperations,
      errorRate: ((totalOperations - successfulOperations) / totalOperations) * 100,
      operationBreakdown
    };
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(timeWindow: number = 300000): {
    totalRequests: number;
    hitRate: number;
    missRate: number;
    keyBreakdown: Record<string, { requests: number; hitRate: number }>;
  } {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.cacheMetrics.filter(m => m.timestamp > cutoff);

    if (recentMetrics.length === 0) {
      return {
        totalRequests: 0,
        hitRate: 0,
        missRate: 0,
        keyBreakdown: {}
      };
    }

    const totalRequests = recentMetrics.length;
    const hits = recentMetrics.filter(m => m.hit).length;

    // Key breakdown
    const keyBreakdown: Record<string, { requests: number; hitRate: number }> = {};
    
    recentMetrics.forEach(metric => {
      const keyType = metric.key.split('_')[0]; // Get key type (e.g., 'membership', 'members')
      if (!keyBreakdown[keyType]) {
        keyBreakdown[keyType] = { requests: 0, hitRate: 0 };
      }
      keyBreakdown[keyType].requests++;
    });

    Object.keys(keyBreakdown).forEach(keyType => {
      const keyMetrics = recentMetrics.filter(m => m.key.startsWith(keyType));
      const keyHits = keyMetrics.filter(m => m.hit).length;
      keyBreakdown[keyType].hitRate = (keyHits / keyMetrics.length) * 100;
    });

    return {
      totalRequests,
      hitRate: (hits / totalRequests) * 100,
      missRate: ((totalRequests - hits) / totalRequests) * 100,
      keyBreakdown
    };
  }

  /**
   * Get engagement statistics
   */
  static getEngagementStats(timeWindow: number = 3600000): {
    totalEvents: number;
    uniqueUsers: number;
    uniqueCommunities: number;
    eventBreakdown: Record<string, number>;
    topCommunities: Array<{ communityId: string; events: number }>;
  } {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.engagementMetrics.filter(m => m.timestamp > cutoff);

    if (recentMetrics.length === 0) {
      return {
        totalEvents: 0,
        uniqueUsers: 0,
        uniqueCommunities: 0,
        eventBreakdown: {},
        topCommunities: []
      };
    }

    const uniqueUsers = new Set(recentMetrics.map(m => m.userId)).size;
    const uniqueCommunities = new Set(recentMetrics.map(m => m.communityId)).size;

    // Event breakdown
    const eventBreakdown: Record<string, number> = {};
    recentMetrics.forEach(metric => {
      eventBreakdown[metric.type] = (eventBreakdown[metric.type] || 0) + 1;
    });

    // Top communities
    const communityEvents: Record<string, number> = {};
    recentMetrics.forEach(metric => {
      communityEvents[metric.communityId] = (communityEvents[metric.communityId] || 0) + 1;
    });

    const topCommunities = Object.entries(communityEvents)
      .map(([communityId, events]) => ({ communityId, events }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 10);

    return {
      totalEvents: recentMetrics.length,
      uniqueUsers,
      uniqueCommunities,
      eventBreakdown,
      topCommunities
    };
  }

  /**
   * Clear old metrics to prevent memory leaks
   */
  static cleanup(): void {
    const cutoff = Date.now() - 3600000; // Keep last hour
    
    this.performanceMetrics = this.performanceMetrics.filter(m => m.timestamp > cutoff);
    this.cacheMetrics = this.cacheMetrics.filter(m => m.timestamp > cutoff);
    this.engagementMetrics = this.engagementMetrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Export metrics for external monitoring
   */
  static exportMetrics(): {
    performance: PerformanceMetric[];
    cache: CacheMetric[];
    engagement: EngagementMetric[];
    timestamp: number;
  } {
    return {
      performance: [...this.performanceMetrics],
      cache: [...this.cacheMetrics],
      engagement: [...this.engagementMetrics],
      timestamp: Date.now()
    };
  }
}

// Auto-cleanup every 10 minutes
setInterval(() => {
  CommunityAnalytics.cleanup();
}, 600000);