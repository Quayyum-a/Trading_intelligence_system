import { getSupabaseClient } from '../../config/supabase.js';
import { getLogger } from '../../config/logger.js';

const logger = getLogger();
const supabase = getSupabaseClient();

interface ExportedData {
  accounts: any[];
  positions: any[];
  balanceEvents: any[];
  positionEvents: any[];
  executions: any[];
  trades: any[];
}

interface EventCoverageReport {
  totalPositions: number;
  positionsWithCompleteEvents: number;
  missingEvents: MissingEvent[];
  coveragePercentage: number;
}

interface MissingEvent {
  positionId: string;
  missingEventTypes: string[];
  positionStatus: string;
}

interface BalanceCheckReport {
  totalEvents: number;
  validEvents: number;
  invalidEvents: InvalidEvent[];
  passed: boolean;
}

interface InvalidEvent {
  eventId: string;
  expected: number;
  actual: number;
  difference: number;
}

interface Discrepancy {
  type: 'BALANCE_MISMATCH' | 'MISSING_EVENT' | 'ORPHANED_EVENT' | 'PNL_MISMATCH';
  entity: string;
  expected: any;
  actual: any;
  difference: number;
}

interface AuditReport {
  coverage: EventCoverageReport;
  balanceCheck: BalanceCheckReport;
  discrepancies: Discrepancy[];
  passed: boolean;
  executedAt: Date;
}

export class ManualAuditorService {
  async performAudit(): Promise<AuditReport> {
    logger.info('🔍 Starting Manual Ledger Audit');
    logger.info('');

    try {
      // 1. Export all data
      logger.info('📤 Step 1: Exporting all data...');
      const data = await this.exportAllData();
      logger.info(`   ✅ Exported ${data.positions.length} positions`);
      logger.info(`   ✅ Exported ${data.balanceEvents.length} balance events`);
      logger.info(`   ✅ Exported ${data.positionEvents.length} position events`);
      logger.info('');

      // 2. Verify event coverage
      logger.info('📋 Step 2: Verifying event coverage...');
      const coverage = await this.verifyEventCoverage(data);
      logger.info(`   Coverage: ${coverage.coveragePercentage.toFixed(2)}%`);
      logger.info(`   Complete: ${coverage.positionsWithCompleteEvents}/${coverage.totalPositions}`);
      logger.info(`   Missing Events: ${coverage.missingEvents.length}`);
      logger.info('');

      // 3. Verify balance equation
      logger.info('🧮 Step 3: Verifying balance equation...');
      const balanceCheck = await this.verifyBalanceEquation(data);
      logger.info(`   Valid Events: ${balanceCheck.validEvents}/${balanceCheck.totalEvents}`);
      logger.info(`   Invalid Events: ${balanceCheck.invalidEvents.length}`);
      logger.info(`   Passed: ${balanceCheck.passed ? '✅' : '❌'}`);
      logger.info('');

      // 4. Calculate expected balances
      logger.info('💰 Step 4: Calculating expected balances...');
      const expected = await this.calculateExpectedBalances(data);
      logger.info(`   Calculated balances for ${expected.size} accounts`);
      logger.info('');

      // 5. Find discrepancies
      logger.info('🔎 Step 5: Finding discrepancies...');
      const discrepancies = await this.findDiscrepancies(expected, data);
      logger.info(`   Discrepancies found: ${discrepancies.length}`);
      logger.info('');

      const passed = 
        coverage.coveragePercentage === 100 &&
        balanceCheck.passed &&
        discrepancies.length === 0;

      return {
        coverage,
        balanceCheck,
        discrepancies,
        passed,
        executedAt: new Date()
      };

    } catch (error) {
      logger.error('💥 Audit failed with exception', error);
      throw error;
    }
  }

  private async exportAllData(): Promise<ExportedData> {
    // Export accounts
    const { data: accounts, error: accError } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: true });

    if (accError) throw accError;

    // Export positions
    const { data: positions, error: posError } = await supabase
      .from('positions')
      .select('*')
      .order('created_at', { ascending: true });

    if (posError) throw posError;

    // Export balance events
    const { data: balanceEvents, error: balError } = await supabase
      .from('account_balance_events')
      .select('*')
      .order('created_at', { ascending: true });

    if (balError) throw balError;

    // Export position events
    const { data: positionEvents, error: posEvError } = await supabase
      .from('position_events')
      .select('*')
      .order('created_at', { ascending: true });

    if (posEvError) throw posEvError;

    // Export executions
    const { data: executions, error: execError } = await supabase
      .from('executions')
      .select('*')
      .order('created_at', { ascending: true });

    if (execError) throw execError;

    // Export trades
    const { data: trades, error: tradeError } = await supabase
      .from('execution_trades')
      .select('*')
      .order('created_at', { ascending: true });

    if (tradeError) throw tradeError;

    return {
      accounts: accounts || [],
      positions: positions || [],
      balanceEvents: balanceEvents || [],
      positionEvents: positionEvents || [],
      executions: executions || [],
      trades: trades || []
    };
  }

  private async verifyEventCoverage(data: ExportedData): Promise<EventCoverageReport> {
    const missingEvents: MissingEvent[] = [];
    let completeCount = 0;

    for (const position of data.positions) {
      const events = data.positionEvents.filter(e => e.position_id === position.id);
      const eventTypes = new Set(events.map(e => e.event_type));

      const missing: string[] = [];

      // Check for required events
      if (!eventTypes.has('POSITION_CREATED')) {
        missing.push('POSITION_CREATED');
      }

      if (position.status === 'OPEN') {
        if (!eventTypes.has('ORDER_FILLED')) {
          missing.push('ORDER_FILLED');
        }
        if (!eventTypes.has('MARGIN_RESERVED')) {
          missing.push('MARGIN_RESERVED');
        }
      }

      if (position.status === 'CLOSED') {
        if (!eventTypes.has('POSITION_CLOSED')) {
          missing.push('POSITION_CLOSED');
        }
        if (!eventTypes.has('MARGIN_RELEASED')) {
          missing.push('MARGIN_RELEASED');
        }
        if (!eventTypes.has('PNL_REALIZED')) {
          missing.push('PNL_REALIZED');
        }
      }

      if (missing.length > 0) {
        missingEvents.push({
          positionId: position.id,
          missingEventTypes: missing,
          positionStatus: position.status
        });
      } else {
        completeCount++;
      }
    }

    const totalPositions = data.positions.length;
    const coveragePercentage = totalPositions > 0 
      ? (completeCount / totalPositions) * 100 
      : 100;

    return {
      totalPositions,
      positionsWithCompleteEvents: completeCount,
      missingEvents,
      coveragePercentage
    };
  }

  private async verifyBalanceEquation(data: ExportedData): Promise<BalanceCheckReport> {
    const invalidEvents: InvalidEvent[] = [];
    let validCount = 0;

    for (const event of data.balanceEvents) {
      const expected = event.balance_before + event.amount;
      const actual = event.balance_after;
      const difference = Math.abs(expected - actual);

      if (difference > 0.01) {
        invalidEvents.push({
          eventId: event.id,
          expected,
          actual,
          difference
        });
      } else {
        validCount++;
      }
    }

    return {
      totalEvents: data.balanceEvents.length,
      validEvents: validCount,
      invalidEvents,
      passed: invalidEvents.length === 0
    };
  }

  private async calculateExpectedBalances(data: ExportedData): Promise<Map<string, number>> {
    const balances = new Map<string, number>();

    for (const account of data.accounts) {
      let balance = account.initial_balance || 10000; // Default initial balance

      const events = data.balanceEvents
        .filter(e => e.account_id === account.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const event of events) {
        balance += event.amount;
      }

      balances.set(account.id, balance);
    }

    return balances;
  }

  private async findDiscrepancies(
    expected: Map<string, number>,
    data: ExportedData
  ): Promise<Discrepancy[]> {
    const discrepancies: Discrepancy[] = [];

    // Check balance mismatches
    const expectedEntries = Array.from(expected.entries());
    for (const [accountId, expectedBalance] of expectedEntries) {
      const latestEvent = data.balanceEvents
        .filter(e => e.account_id === accountId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

      if (latestEvent) {
        const actualBalance = latestEvent.balance_after;
        const difference = Math.abs(expectedBalance - actualBalance);

        if (difference > 0.01) {
          discrepancies.push({
            type: 'BALANCE_MISMATCH',
            entity: accountId,
            expected: expectedBalance,
            actual: actualBalance,
            difference
          });
        }
      }
    }

    // Check for orphaned events
    const positionIds = new Set(data.positions.map(p => p.id));
    for (const event of data.positionEvents) {
      if (!positionIds.has(event.position_id)) {
        discrepancies.push({
          type: 'ORPHANED_EVENT',
          entity: event.id,
          expected: 'Position exists',
          actual: 'Position not found',
          difference: 0
        });
      }
    }

    // Check PnL calculations for closed positions
    for (const position of data.positions.filter(p => p.status === 'CLOSED')) {
      if (position.realized_pnl !== null && position.realized_pnl !== undefined) {
        // Calculate expected PnL from events
        const pnlEvents = data.balanceEvents.filter(
          e => e.position_id === position.id && e.event_type === 'PNL_REALIZED'
        );

        const expectedPnl = pnlEvents.reduce((sum, e) => sum + e.amount, 0);
        const actualPnl = position.realized_pnl;
        const difference = Math.abs(expectedPnl - actualPnl);

        if (difference > 0.01) {
          discrepancies.push({
            type: 'PNL_MISMATCH',
            entity: position.id,
            expected: expectedPnl,
            actual: actualPnl,
            difference
          });
        }
      }
    }

    return discrepancies;
  }
}
