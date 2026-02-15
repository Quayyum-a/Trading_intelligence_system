/**
 * Task 10: Ledger Integrity Validation Service
 * Requirements: 3.3.1, 3.3.2, 3.3.3, 3.3.4, 3.3.5, 3.3.6
 * 
 * This service validates the integrity of the account balance ledger by checking:
 * 1. Sum of events equals current balance
 * 2. Every position has balance events
 * 3. No orphaned events
 * 4. Balance equation holds for all events
 */

import { AccountBalanceEvent, BalanceEventType } from '../types/position-lifecycle.types';

export interface IntegrityViolation {
  type: 'SUM_MISMATCH' | 'MISSING_POSITION_EVENTS' | 'ORPHANED_EVENT' | 'BALANCE_EQUATION_VIOLATION';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  details: any;
}

export interface IntegrityReport {
  accountId: string;
  timestamp: Date;
  passed: boolean;
  violations: IntegrityViolation[];
  summary: {
    totalEvents: number;
    totalPositions: number;
    currentBalance: number;
    calculatedBalance: number;
    balanceDifference: number;
  };
}

export class LedgerIntegrityService {
  constructor(
    private readonly accountRepository: any,
    private readonly balanceEventRepository: any,
    private readonly positionRepository: any
  ) {}

  /**
   * Task 10.1: Validate ledger integrity for an account
   * Requirements: 3.3.1, 3.3.3
   * 
   * Checks 4 integrity rules:
   * 1. Sum of events = current balance
   * 2. Every position has balance events
   * 3. No orphaned events
   * 4. Balance equation holds for all events
   */
  async validateIntegrity(accountId: string): Promise<IntegrityReport> {
    const violations: IntegrityViolation[] = [];
    
    // Get account
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get all balance events for this account
    const events = await this.balanceEventRepository.findByAccountId(accountId);
    
    // Get all positions for this account
    const positions = await this.positionRepository.findByAccountId(accountId);

    // Rule 1: Sum of events = current balance (Property 35)
    const sumViolations = await this.checkSumIntegrity(accountId, account.balance, events);
    violations.push(...sumViolations);

    // Rule 2: Every position has balance events (Property 36)
    const positionViolations = await this.checkPositionEventCoverage(positions, events);
    violations.push(...positionViolations);

    // Rule 3: No orphaned events (Property 37)
    const orphanViolations = await this.checkOrphanedEvents(events, positions);
    violations.push(...orphanViolations);

    // Rule 4: Balance equation holds for all events (Property 26)
    const equationViolations = this.checkBalanceEquation(events);
    violations.push(...equationViolations);

    // Calculate summary
    const calculatedBalance = this.calculateBalanceFromEvents(events);
    const balanceDifference = Math.abs(account.balance - calculatedBalance);

    return {
      accountId,
      timestamp: new Date(),
      passed: violations.length === 0,
      violations,
      summary: {
        totalEvents: events.length,
        totalPositions: positions.length,
        currentBalance: account.balance,
        calculatedBalance,
        balanceDifference
      }
    };
  }

  /**
   * Task 10.2: Property 35 - Ledger Sum Integrity
   * Requirement: 3.3.3
   * Verify sum of events equals current balance
   */
  private async checkSumIntegrity(
    accountId: string,
    currentBalance: number,
    events: AccountBalanceEvent[]
  ): Promise<IntegrityViolation[]> {
    const violations: IntegrityViolation[] = [];

    // Calculate balance from events
    const calculatedBalance = this.calculateBalanceFromEvents(events);
    const difference = Math.abs(currentBalance - calculatedBalance);

    // Allow small floating point differences (0.01)
    if (difference > 0.01) {
      violations.push({
        type: 'SUM_MISMATCH',
        severity: 'CRITICAL',
        description: 'Sum of balance events does not match current account balance',
        details: {
          currentBalance,
          calculatedBalance,
          difference,
          eventCount: events.length
        }
      });
    }

    return violations;
  }

  /**
   * Task 10.3: Property 36 - Position Event Coverage
   * Requirement: 3.3.3
   * Verify every position has margin events
   */
  private async checkPositionEventCoverage(
    positions: any[],
    events: AccountBalanceEvent[]
  ): Promise<IntegrityViolation[]> {
    const violations: IntegrityViolation[] = [];

    for (const position of positions) {
      // Check for MARGIN_RESERVED event
      const hasMarginReserved = events.some(
        e => e.positionId === position.id && e.eventType === BalanceEventType.MARGIN_RESERVED
      );

      if (!hasMarginReserved) {
        violations.push({
          type: 'MISSING_POSITION_EVENTS',
          severity: 'HIGH',
          description: `Position ${position.id} missing MARGIN_RESERVED event`,
          details: {
            positionId: position.id,
            status: position.status,
            missingEventType: 'MARGIN_RESERVED'
          }
        });
      }

      // If position is closed, check for MARGIN_RELEASED and PNL_REALIZED events
      if (position.status === 'CLOSED') {
        const hasMarginReleased = events.some(
          e => e.positionId === position.id && e.eventType === BalanceEventType.MARGIN_RELEASED
        );

        if (!hasMarginReleased) {
          violations.push({
            type: 'MISSING_POSITION_EVENTS',
            severity: 'HIGH',
            description: `Closed position ${position.id} missing MARGIN_RELEASED event`,
            details: {
              positionId: position.id,
              status: position.status,
              missingEventType: 'MARGIN_RELEASED'
            }
          });
        }

        const hasPnLRealized = events.some(
          e => e.positionId === position.id && e.eventType === BalanceEventType.PNL_REALIZED
        );

        if (!hasPnLRealized) {
          violations.push({
            type: 'MISSING_POSITION_EVENTS',
            severity: 'HIGH',
            description: `Closed position ${position.id} missing PNL_REALIZED event`,
            details: {
              positionId: position.id,
              status: position.status,
              missingEventType: 'PNL_REALIZED'
            }
          });
        }
      }
    }

    return violations;
  }

  /**
   * Task 10.4: Property 37 - No Orphaned Events
   * Requirement: 3.3.3
   * Verify all events reference valid positions
   */
  private async checkOrphanedEvents(
    events: AccountBalanceEvent[],
    positions: any[]
  ): Promise<IntegrityViolation[]> {
    const violations: IntegrityViolation[] = [];
    const positionIds = new Set(positions.map(p => p.id));

    for (const event of events) {
      // Skip events that don't reference positions (e.g., DEPOSIT, WITHDRAWAL)
      if (!event.positionId) {
        continue;
      }

      // Check if referenced position exists
      if (!positionIds.has(event.positionId)) {
        violations.push({
          type: 'ORPHANED_EVENT',
          severity: 'MEDIUM',
          description: `Balance event references non-existent position`,
          details: {
            eventId: event.id,
            eventType: event.eventType,
            positionId: event.positionId,
            createdAt: event.createdAt
          }
        });
      }
    }

    return violations;
  }

  /**
   * Property 26: Balance Equation Enforcement
   * Requirement: 3.1.3
   * Verify balance_after = balance_before + amount for all events
   */
  private checkBalanceEquation(events: AccountBalanceEvent[]): IntegrityViolation[] {
    const violations: IntegrityViolation[] = [];

    for (const event of events) {
      const expected = event.balance_before + event.amount;
      const difference = Math.abs(event.balance_after - expected);

      // Allow small floating point differences (0.0001)
      if (difference > 0.0001) {
        violations.push({
          type: 'BALANCE_EQUATION_VIOLATION',
          severity: 'CRITICAL',
          description: 'Balance equation violated: balance_after != balance_before + amount',
          details: {
            eventId: event.id,
            eventType: event.eventType,
            balance_before: event.balance_before,
            amount: event.amount,
            balance_after: event.balance_after,
            expected,
            difference
          }
        });
      }
    }

    return violations;
  }

  /**
   * Calculate balance from sum of events
   */
  private calculateBalanceFromEvents(events: AccountBalanceEvent[]): number {
    // Sort events by creation time
    const sortedEvents = [...events].sort((a, b) => 
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Sum all amounts
    return sortedEvents.reduce((sum, event) => sum + event.amount, 0);
  }

  /**
   * Task 10.5: Run automatic integrity checks
   * Requirements: 3.3.2, 3.3.4, 3.3.5
   * 
   * This method should be called periodically (e.g., every hour)
   */
  async runPeriodicCheck(accountId: string): Promise<void> {
    const report = await this.validateIntegrity(accountId);

    if (!report.passed) {
      // Requirement 3.3.2: Alert on any discrepancy
      await this.sendAlert(report);
      
      // Requirement 3.3.4: Generate detailed error report
      await this.generateErrorReport(report);
    }
  }

  /**
   * Send alert for integrity violations
   */
  private async sendAlert(report: IntegrityReport): Promise<void> {
    console.error('[LedgerIntegrity] ALERT - Integrity violations detected:', {
      accountId: report.accountId,
      violationCount: report.violations.length,
      criticalViolations: report.violations.filter(v => v.severity === 'CRITICAL').length,
      timestamp: report.timestamp
    });

    // In production, this would send alerts via email, Slack, PagerDuty, etc.
  }

  /**
   * Generate detailed error report
   */
  private async generateErrorReport(report: IntegrityReport): Promise<void> {
    console.error('[LedgerIntegrity] Detailed Error Report:', JSON.stringify(report, null, 2));

    // In production, this would save to a file or database for audit
  }

  /**
   * Task 10.6: Manual integrity check API endpoint helper
   * Requirement: 3.3.6
   * 
   * Returns detailed integrity report for manual validation
   */
  async generateIntegrityReport(accountId: string): Promise<IntegrityReport> {
    return this.validateIntegrity(accountId);
  }
}
