import { getLogger } from '../../config/logger.js';
import { getSupabaseClient } from '../../config/supabase.js';

const logger = getLogger();
const supabase = getSupabaseClient();

interface HealthCheck {
  timestamp: Date;
  cpu: number;
  memory: number;
  disk: number;
  databaseConnected: boolean;
  brokerConnected: boolean;
}

interface PositionCheck {
  timestamp: Date;
  openPositions: number;
  accountBalance: number;
  marginUsed: number;
  reconciliationStatus: 'MATCHED' | 'MISMATCHED';
}

interface IntegrityCheck {
  timestamp: Date;
  balanceEquation: boolean;
  orphanedEvents: number;
  orphanedPositions: number;
  eventCoverage: number;
}

interface Alert {
  timestamp: Date;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  details: any;
}

interface MonitoringReport {
  duration: number;
  startTime: Date;
  endTime: Date;
  healthChecks: HealthCheck[];
  positionChecks: PositionCheck[];
  integrityChecks: IntegrityCheck[];
  alerts: Alert[];
  criticalErrors: Error[];
  passed: boolean;
}

export class ContinuousMonitorService {
  private healthChecks: HealthCheck[] = [];
  private positionChecks: PositionCheck[] = [];
  private integrityChecks: IntegrityCheck[] = [];
  private alerts: Alert[] = [];
  private criticalErrors: Error[] = [];
  private isRunning = false;

  async startMonitoring(durationMs: number): Promise<MonitoringReport> {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationMs);
    
    logger.info('🚀 Starting continuous monitoring', {
      duration: `${durationMs / 1000 / 60 / 60} hours`,
      startTime,
      endTime
    });

    this.isRunning = true;
    let lastHealthCheck = 0;
    let lastPositionCheck = 0;
    let lastIntegrityCheck = 0;

    while (Date.now() < endTime.getTime() && this.isRunning) {
      const now = Date.now();

      // Health check every 1 minute
      if (now - lastHealthCheck >= 60000) {
        await this.checkHealth();
        lastHealthCheck = now;
      }

      // Position check every 10 minutes
      if (now - lastPositionCheck >= 600000) {
        await this.checkPositions();
        lastPositionCheck = now;
      }

      // Integrity check every 1 hour
      if (now - lastIntegrityCheck >= 3600000) {
        await this.checkIntegrity();
        lastIntegrityCheck = now;
      }

      // Sleep for 10 seconds before next iteration
      await this.sleep(10000);
    }

    this.isRunning = false;
    return this.generateReport(startTime, endTime);
  }

  async stopMonitoring(): Promise<void> {
    logger.info('⏹️  Stopping continuous monitoring');
    this.isRunning = false;
  }

  private async checkHealth(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // Check database connection
      const { error: dbError } = await supabase
        .from('positions')
        .select('id')
        .limit(1);

      const healthCheck: HealthCheck = {
        timestamp: new Date(),
        cpu: cpuUsage.user / 1000000, // Convert to seconds
        memory: memUsage.heapUsed / 1024 / 1024, // Convert to MB
        disk: 0, // Would need OS-specific implementation
        databaseConnected: !dbError,
        brokerConnected: true // Would check actual broker connection
      };

      this.healthChecks.push(healthCheck);

      // Check for high resource usage
      if (healthCheck.memory > 500) {
        this.addAlert('MEDIUM', 'High memory usage detected', healthCheck);
      }

      if (!healthCheck.databaseConnected) {
        this.addAlert('CRITICAL', 'Database connection lost', healthCheck);
      }

      logger.debug('✅ Health check completed', healthCheck);
    } catch (error) {
      logger.error('❌ Health check failed', error);
      this.criticalErrors.push(error as Error);
      this.addAlert('CRITICAL', 'Health check failed', { error });
    }
  }

  private async checkPositions(): Promise<void> {
    try {
      // Get open positions
      const { data: positions, error: posError } = await supabase
        .from('positions')
        .select('*')
        .eq('status', 'OPEN');

      if (posError) throw posError;

      // Get account balance
      const { data: balanceEvents, error: balError } = await supabase
        .from('account_balance_events')
        .select('balance_after')
        .order('created_at', { ascending: false })
        .limit(1);

      if (balError) throw balError;

      // Calculate margin used
      const marginUsed = positions?.reduce((sum, pos) => {
        return sum + (pos.margin_required || 0);
      }, 0) || 0;

      // Check reconciliation status (simplified - would check actual reconciliation)
      let reconciliationStatus: 'MATCHED' | 'MISMATCHED' = 'MATCHED';
      // In production, would run actual reconciliation check here

      const positionCheck: PositionCheck = {
        timestamp: new Date(),
        openPositions: positions?.length || 0,
        accountBalance: balanceEvents?.[0]?.balance_after || 0,
        marginUsed,
        reconciliationStatus
      };

      this.positionChecks.push(positionCheck);

      // Check for reconciliation mismatch
      if (positionCheck.reconciliationStatus !== 'MATCHED') {
        this.addAlert('CRITICAL', 'Reconciliation mismatch detected', positionCheck);
      }

      logger.debug('✅ Position check completed', positionCheck);
    } catch (error) {
      logger.error('❌ Position check failed', error);
      this.criticalErrors.push(error as Error);
      this.addAlert('CRITICAL', 'Position check failed', { error });
    }
  }

  private async checkIntegrity(): Promise<void> {
    try {
      // Check balance equation
      const balanceEquation = await this.verifyBalanceEquation();

      // Check for orphaned events
      const orphanedEvents = await this.countOrphanedEvents();

      // Check for orphaned positions
      const orphanedPositions = await this.countOrphanedPositions();

      // Calculate event coverage
      const eventCoverage = await this.calculateEventCoverage();

      const integrityCheck: IntegrityCheck = {
        timestamp: new Date(),
        balanceEquation,
        orphanedEvents,
        orphanedPositions,
        eventCoverage
      };

      this.integrityChecks.push(integrityCheck);

      // Check for integrity violations
      if (!balanceEquation) {
        this.addAlert('CRITICAL', 'Balance equation violated', integrityCheck);
      }

      if (orphanedEvents > 0) {
        this.addAlert('CRITICAL', `${orphanedEvents} orphaned events detected`, integrityCheck);
      }

      if (orphanedPositions > 0) {
        this.addAlert('CRITICAL', `${orphanedPositions} orphaned positions detected`, integrityCheck);
      }

      if (eventCoverage < 100) {
        this.addAlert('HIGH', `Event coverage at ${eventCoverage}%`, integrityCheck);
      }

      logger.info('✅ Integrity check completed', integrityCheck);
    } catch (error) {
      logger.error('❌ Integrity check failed', error);
      this.criticalErrors.push(error as Error);
      this.addAlert('CRITICAL', 'Integrity check failed', { error });
    }
  }

  private async verifyBalanceEquation(): Promise<boolean> {
    try {
      const { data: events, error } = await supabase
        .from('account_balance_events')
        .select('balance_before, balance_after, amount')
        .order('created_at', { ascending: true });

      if (error) throw error;

      for (const event of events || []) {
        const expected = event.balance_before + event.amount;
        const actual = event.balance_after;
        
        if (Math.abs(expected - actual) > 0.01) {
          logger.error('Balance equation violated', { event, expected, actual });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Failed to verify balance equation', error);
      return false;
    }
  }

  private async countOrphanedEvents(): Promise<number> {
    try {
      // Events without corresponding positions
      const { data, error } = await supabase.rpc('count_orphaned_events');
      
      if (error) {
        // Fallback: manual count
        const { data: events } = await supabase
          .from('position_events')
          .select('position_id');
        
        const { data: positions } = await supabase
          .from('positions')
          .select('id');
        
        const positionIds = new Set(positions?.map(p => p.id) || []);
        return events?.filter(e => !positionIds.has(e.position_id)).length || 0;
      }

      return data || 0;
    } catch (error) {
      logger.error('Failed to count orphaned events', error);
      return 0;
    }
  }

  private async countOrphanedPositions(): Promise<number> {
    try {
      // Positions without required events
      const { data: positions } = await supabase
        .from('positions')
        .select('id, status');

      let orphanedCount = 0;

      for (const position of positions || []) {
        const { data: events } = await supabase
          .from('position_events')
          .select('event_type')
          .eq('position_id', position.id);

        const eventTypes = new Set(events?.map(e => e.event_type) || []);

        // Every position should have POSITION_CREATED
        if (!eventTypes.has('POSITION_CREATED')) {
          orphanedCount++;
        }

        // Closed positions should have POSITION_CLOSED
        if (position.status === 'CLOSED' && !eventTypes.has('POSITION_CLOSED')) {
          orphanedCount++;
        }
      }

      return orphanedCount;
    } catch (error) {
      logger.error('Failed to count orphaned positions', error);
      return 0;
    }
  }

  private async calculateEventCoverage(): Promise<number> {
    try {
      const { data: positions } = await supabase
        .from('positions')
        .select('id, status');

      if (!positions || positions.length === 0) return 100;

      let completeCount = 0;

      for (const position of positions) {
        const { data: events } = await supabase
          .from('position_events')
          .select('event_type')
          .eq('position_id', position.id);

        const eventTypes = new Set(events?.map(e => e.event_type) || []);

        // Check for required events
        const hasCreated = eventTypes.has('POSITION_CREATED');
        const hasClosed = position.status === 'CLOSED' ? eventTypes.has('POSITION_CLOSED') : true;

        if (hasCreated && hasClosed) {
          completeCount++;
        }
      }

      return (completeCount / positions.length) * 100;
    } catch (error) {
      logger.error('Failed to calculate event coverage', error);
      return 0;
    }
  }

  private addAlert(level: 'CRITICAL' | 'HIGH' | 'MEDIUM', message: string, details: any): void {
    const alert: Alert = {
      timestamp: new Date(),
      level,
      message,
      details
    };

    this.alerts.push(alert);
    
    const emoji = level === 'CRITICAL' ? '🔴' : level === 'HIGH' ? '🟠' : '🟡';
    logger.warn(`${emoji} ALERT [${level}]: ${message}`, details);
  }

  private generateReport(startTime: Date, endTime: Date): MonitoringReport {
    const duration = endTime.getTime() - startTime.getTime();
    const passed = this.criticalErrors.length === 0 && 
                   this.alerts.filter(a => a.level === 'CRITICAL').length === 0;

    const report: MonitoringReport = {
      duration,
      startTime,
      endTime,
      healthChecks: this.healthChecks,
      positionChecks: this.positionChecks,
      integrityChecks: this.integrityChecks,
      alerts: this.alerts,
      criticalErrors: this.criticalErrors,
      passed
    };

    logger.info('📊 Monitoring report generated', {
      duration: `${duration / 1000 / 60 / 60} hours`,
      healthChecks: this.healthChecks.length,
      positionChecks: this.positionChecks.length,
      integrityChecks: this.integrityChecks.length,
      alerts: this.alerts.length,
      criticalErrors: this.criticalErrors.length,
      passed
    });

    return report;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
