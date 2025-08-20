import { supabase } from '../supabase';

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  error?: string;
  timestamp: number;
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: HealthCheckResult[];
  timestamp: number;
}

export class HealthChecks {
  private static lastCheck: SystemHealth | null = null;
  private static checkInterval: NodeJS.Timeout | null = null;

  /**
   * Check Edge Function availability
   */
  static async checkEdgeFunction(functionName: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}?operation=health_check`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000) // 5 second timeout
        }
      );

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        service: `edge-function-${functionName}`,
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        timestamp: Date.now()
      };
    } catch (err) {
      return {
        service: `edge-function-${functionName}`,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Check database connection health
   */
  static async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple query to test database connectivity
      const { error } = await supabase
        .from('users')
        .select('count')
        .limit(1);

      const responseTime = Date.now() - startTime;

      if (error) {
        throw error;
      }

      return {
        service: 'database',
        status: responseTime < 500 ? 'healthy' : 'degraded',
        responseTime,
        timestamp: Date.now()
      };
    } catch (err) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Check community features availability
   */
  static async checkCommunityFeatures(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test basic community query
      const { data, error } = await supabase
        .from('communities')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      const responseTime = Date.now() - startTime;

      if (error) {
        throw error;
      }

      return {
        service: 'community-features',
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        timestamp: Date.now()
      };
    } catch (err) {
      return {
        service: 'community-features',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Run comprehensive health check
   */
  static async runHealthCheck(): Promise<SystemHealth> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkEdgeFunction('community-operations'),
      this.checkEdgeFunction('community-chat'),
      this.checkCommunityFeatures()
    ]);

    // Determine overall health
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    const systemHealth: SystemHealth = {
      overall,
      services: checks,
      timestamp: Date.now()
    };

    this.lastCheck = systemHealth;
    return systemHealth;
  }

  /**
   * Get last health check result
   */
  static getLastHealthCheck(): SystemHealth | null {
    return this.lastCheck;
  }

  /**
   * Start periodic health monitoring
   */
  static startMonitoring(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.runHealthCheck();
      } catch (err) {
        console.error('Health check failed:', err);
      }
    }, intervalMs);

    // Run initial check
    this.runHealthCheck();
  }

  /**
   * Stop health monitoring
   */
  static stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get service status for admin dashboard
   */
  static getServiceStatus(): {
    database: 'healthy' | 'degraded' | 'unhealthy';
    edgeFunctions: 'healthy' | 'degraded' | 'unhealthy';
    communityFeatures: 'healthy' | 'degraded' | 'unhealthy';
    lastUpdated: number | null;
  } {
    if (!this.lastCheck) {
      return {
        database: 'unhealthy',
        edgeFunctions: 'unhealthy',
        communityFeatures: 'unhealthy',
        lastUpdated: null
      };
    }

    const dbCheck = this.lastCheck.services.find(s => s.service === 'database');
    const edgeCheck = this.lastCheck.services.find(s => s.service.startsWith('edge-function'));
    const communityCheck = this.lastCheck.services.find(s => s.service === 'community-features');

    return {
      database: dbCheck?.status || 'unhealthy',
      edgeFunctions: edgeCheck?.status || 'unhealthy',
      communityFeatures: communityCheck?.status || 'unhealthy',
      lastUpdated: this.lastCheck.timestamp
    };
  }
}