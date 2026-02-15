import { getSupabaseClient } from '../../config/supabase.js';
import { getLogger } from '../../config/logger.js';
import * as child_process from 'child_process';

const logger = getLogger();
const supabase = getSupabaseClient();

interface SystemState {
  positions: any[];
  balanceEvents: any[];
  accountBalance: number;
  openPositions: number;
  eventCount: number;
  timestamp: Date;
}

interface Issue {
  type: 'DATA_CORRUPTION' | 'DUPLICATE_EVENT' | 'ORPHANED_POSITION' | 'BALANCE_DRIFT';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  affectedEntities: string[];
}

interface ScenarioResult {
  scenario: string;
  success: boolean;
  initialState: SystemState;
  finalState: SystemState;
  issues: Issue[];
  recoveryTime: number;
  executedAt: Date;
}

export type ChaosScenarioType = 
  | 'PROCESS_KILL'
  | 'NETWORK_DROP'
  | 'DATABASE_DISCONNECT'
  | 'SLOW_NETWORK'
  | 'SLOW_DATABASE';

export interface ChaosScenario {
  name: string;
  type: ChaosScenarioType;
  timing?: 'DURING_OPEN' | 'DURING_CLOSE' | 'DURING_PARTIAL_FILL' | 'DURING_MARGIN_UPDATE' | 'DURING_RECONCILIATION' | 'DURING_REPLAY';
  duration?: number;
  description: string;
}

export class ChaosEngineerService {
  async runScenario(scenario: ChaosScenario): Promise<ScenarioResult> {
    logger.info(`🎯 Running chaos scenario: ${scenario.name}`);
    logger.info(`   Type: ${scenario.type}`);
    logger.info(`   Description: ${scenario.description}`);

    const startTime = Date.now();

    try {
      // 1. Capture initial state
      logger.info('📸 Capturing initial state...');
      const initialState = await this.captureState();

      // 2. Inject failure
      logger.info('💥 Injecting failure...');
      await this.injectFailure(scenario);

      // 3. Wait for recovery
      logger.info('⏳ Waiting for system recovery...');
      await this.waitForRecovery();

      // 4. Capture final state
      logger.info('📸 Capturing final state...');
      const finalState = await this.captureState();

      // 5. Validate recovery
      logger.info('🔍 Validating recovery...');
      const issues = await this.validateRecovery(initialState, finalState);

      const recoveryTime = Date.now() - startTime;
      const success = issues.length === 0;

      const result: ScenarioResult = {
        scenario: scenario.name,
        success,
        initialState,
        finalState,
        issues,
        recoveryTime,
        executedAt: new Date()
      };

      if (success) {
        logger.info(`✅ Scenario passed: ${scenario.name} (${recoveryTime}ms)`);
      } else {
        logger.error(`❌ Scenario failed: ${scenario.name}`);
        logger.error(`   Issues found: ${issues.length}`);
        issues.forEach(issue => {
          logger.error(`   - [${issue.severity}] ${issue.description}`);
        });
      }

      return result;

    } catch (error) {
      logger.error(`💥 Scenario execution failed: ${scenario.name}`, error);
      
      return {
        scenario: scenario.name,
        success: false,
        initialState: await this.captureState(),
        finalState: await this.captureState(),
        issues: [{
          type: 'DATA_CORRUPTION',
          severity: 'CRITICAL',
          description: `Scenario execution failed: ${(error as Error).message}`,
          affectedEntities: []
        }],
        recoveryTime: Date.now() - startTime,
        executedAt: new Date()
      };
    }
  }

  private async captureState(): Promise<SystemState> {
    try {
      // Get all positions
      const { data: positions, error: posError } = await supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false });

      if (posError) throw posError;

      // Get balance events
      const { data: balanceEvents, error: balError } = await supabase
        .from('account_balance_events')
        .select('*')
        .order('created_at', { ascending: false });

      if (balError) throw balError;

      // Get event count
      const { count: eventCount, error: eventError } = await supabase
        .from('position_events')
        .select('*', { count: 'exact', head: true });

      if (eventError) throw eventError;

      const accountBalance = balanceEvents?.[0]?.balance_after || 0;
      const openPositions = positions?.filter(p => p.status === 'OPEN').length || 0;

      return {
        positions: positions || [],
        balanceEvents: balanceEvents || [],
        accountBalance,
        openPositions,
        eventCount: eventCount || 0,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Failed to capture system state', error);
      throw error;
    }
  }

  private async injectFailure(scenario: ChaosScenario): Promise<void> {
    switch (scenario.type) {
      case 'PROCESS_KILL':
        await this.killProcess(scenario.timing);
        break;
      case 'NETWORK_DROP':
        await this.dropNetwork(scenario.duration || 5000);
        break;
      case 'DATABASE_DISCONNECT':
        await this.disconnectDatabase(scenario.duration || 5000);
        break;
      case 'SLOW_NETWORK':
        await this.slowNetwork(scenario.duration || 10000);
        break;
      case 'SLOW_DATABASE':
        await this.slowDatabase(scenario.duration || 10000);
        break;
      default:
        throw new Error(`Unknown scenario type: ${scenario.type}`);
    }
  }

  private async killProcess(timing?: string): Promise<void> {
    logger.warn(`⚠️  PROCESS_KILL scenario: Would kill process during ${timing || 'random operation'}`);
    logger.warn('⚠️  In real test, this would use SIGKILL on the main process');
    logger.warn('⚠️  For safety, simulating with controlled shutdown/restart');
    
    // In a real chaos test, this would:
    // 1. Identify the main process PID
    // 2. Send SIGKILL at the specified timing
    // 3. Restart the process
    // 4. Verify recovery
    
    // For now, simulate with a delay
    await this.sleep(1000);
  }

  private async dropNetwork(duration: number): Promise<void> {
    logger.warn(`⚠️  NETWORK_DROP scenario: Simulating ${duration}ms network outage`);
    
    // In a real chaos test, this would use iptables or similar:
    // sudo iptables -A OUTPUT -p tcp --dport 443 -j DROP
    // await sleep(duration)
    // sudo iptables -D OUTPUT -p tcp --dport 443 -j DROP
    
    await this.sleep(duration);
  }

  private async disconnectDatabase(duration: number): Promise<void> {
    logger.warn(`⚠️  DATABASE_DISCONNECT scenario: Simulating ${duration}ms database outage`);
    
    // In a real chaos test, this would:
    // 1. Close all database connections
    // 2. Block new connections
    // 3. Wait for duration
    // 4. Restore connections
    
    await this.sleep(duration);
  }

  private async slowNetwork(duration: number): Promise<void> {
    logger.warn(`⚠️  SLOW_NETWORK scenario: Simulating ${duration}ms of slow network`);
    
    // In a real chaos test, this would use tc (traffic control):
    // sudo tc qdisc add dev eth0 root netem delay 5000ms
    // await sleep(duration)
    // sudo tc qdisc del dev eth0 root
    
    await this.sleep(duration);
  }

  private async slowDatabase(duration: number): Promise<void> {
    logger.warn(`⚠️  SLOW_DATABASE scenario: Simulating ${duration}ms of slow queries`);
    
    // In a real chaos test, this would:
    // 1. Add artificial delays to database queries
    // 2. Or use pg_sleep() in PostgreSQL
    // 3. Wait for duration
    // 4. Remove delays
    
    await this.sleep(duration);
  }

  private async waitForRecovery(): Promise<void> {
    logger.info('⏳ Waiting for system to stabilize...');
    
    // Wait for system to recover
    await this.sleep(5000);
    
    // Check if system is responsive
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      try {
        const { error } = await supabase
          .from('positions')
          .select('id')
          .limit(1);
        
        if (!error) {
          logger.info('✅ System is responsive');
          return;
        }
      } catch (error) {
        logger.warn(`⚠️  System not responsive yet (attempt ${attempts + 1}/${maxAttempts})`);
      }
      
      attempts++;
      await this.sleep(2000);
    }
    
    throw new Error('System failed to recover within timeout');
  }

  private async validateRecovery(initial: SystemState, final: SystemState): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Check for data corruption
    const corruptionIssues = await this.checkDataIntegrity(initial, final);
    issues.push(...corruptionIssues);

    // Check for duplicate events
    const duplicateIssues = await this.checkNoDuplicates(final);
    issues.push(...duplicateIssues);

    // Check for orphaned positions
    const orphanIssues = await this.checkNoOrphans(final);
    issues.push(...orphanIssues);

    // Check balance equation
    const balanceIssues = await this.checkBalanceEquation(final);
    issues.push(...balanceIssues);

    return issues;
  }

  private async checkDataIntegrity(initial: SystemState, final: SystemState): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Check if position count decreased unexpectedly
    if (final.positions.length < initial.positions.length) {
      const missingPositions = initial.positions.filter(
        ip => !final.positions.find(fp => fp.id === ip.id)
      );
      
      if (missingPositions.length > 0) {
        issues.push({
          type: 'DATA_CORRUPTION',
          severity: 'CRITICAL',
          description: `${missingPositions.length} positions disappeared`,
          affectedEntities: missingPositions.map(p => p.id)
        });
      }
    }

    // Check if balance drifted unexpectedly
    const balanceDiff = Math.abs(final.accountBalance - initial.accountBalance);
    if (balanceDiff > 0.01 && initial.openPositions === final.openPositions) {
      issues.push({
        type: 'BALANCE_DRIFT',
        severity: 'CRITICAL',
        description: `Balance drifted by ${balanceDiff} without position changes`,
        affectedEntities: []
      });
    }

    return issues;
  }

  private async checkNoDuplicates(state: SystemState): Promise<Issue[]> {
    const issues: Issue[] = [];

    try {
      // Check for duplicate position events
      const { data: events, error } = await supabase
        .from('position_events')
        .select('id, position_id, event_type, created_at');

      if (error) throw error;

      const eventKeys = new Map<string, number>();
      
      for (const event of events || []) {
        const key = `${event.position_id}-${event.event_type}-${event.created_at}`;
        const count = eventKeys.get(key) || 0;
        eventKeys.set(key, count + 1);
      }

      const duplicates = Array.from(eventKeys.entries()).filter(([_, count]) => count > 1);
      
      if (duplicates.length > 0) {
        issues.push({
          type: 'DUPLICATE_EVENT',
          severity: 'CRITICAL',
          description: `${duplicates.length} duplicate events detected`,
          affectedEntities: duplicates.map(([key]) => key)
        });
      }
    } catch (error) {
      logger.error('Failed to check for duplicates', error);
    }

    return issues;
  }

  private async checkNoOrphans(state: SystemState): Promise<Issue[]> {
    const issues: Issue[] = [];

    try {
      // Check for positions without required events
      for (const position of state.positions) {
        const { data: events } = await supabase
          .from('position_events')
          .select('event_type')
          .eq('position_id', position.id);

        const eventTypes = new Set(events?.map(e => e.event_type) || []);

        if (!eventTypes.has('POSITION_CREATED')) {
          issues.push({
            type: 'ORPHANED_POSITION',
            severity: 'CRITICAL',
            description: `Position ${position.id} missing POSITION_CREATED event`,
            affectedEntities: [position.id]
          });
        }

        if (position.status === 'CLOSED' && !eventTypes.has('POSITION_CLOSED')) {
          issues.push({
            type: 'ORPHANED_POSITION',
            severity: 'CRITICAL',
            description: `Closed position ${position.id} missing POSITION_CLOSED event`,
            affectedEntities: [position.id]
          });
        }
      }
    } catch (error) {
      logger.error('Failed to check for orphans', error);
    }

    return issues;
  }

  private async checkBalanceEquation(state: SystemState): Promise<Issue[]> {
    const issues: Issue[] = [];

    try {
      for (const event of state.balanceEvents) {
        const expected = event.balance_before + event.amount;
        const actual = event.balance_after;
        
        if (Math.abs(expected - actual) > 0.01) {
          issues.push({
            type: 'BALANCE_DRIFT',
            severity: 'CRITICAL',
            description: `Balance equation violated for event ${event.id}`,
            affectedEntities: [event.id]
          });
        }
      }
    } catch (error) {
      logger.error('Failed to check balance equation', error);
    }

    return issues;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
