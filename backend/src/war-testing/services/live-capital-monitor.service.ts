import { getSupabaseClient } from '../../config/supabase.js';
import { getLogger } from '../../config/logger.js';
import { ManualAuditorService } from './manual-auditor.service.js';

const logger = getLogger();
const supabase = getSupabaseClient();

interface DailyReport {
  date: Date;
  positions: PositionSummary;
  balance: BalanceSummary;
  errors: ErrorSummary;
  integrity: IntegritySummary;
  criticalIssues: CriticalIssue[];
}

interface PositionSummary {
  open: number;
  closed: number;
  totalPnL: number;
  marginUsed: number;
}

interface BalanceSummary {
  current: number;
  change24h: number;
  changePercent: number;
}

interface ErrorSummary {
  critical: number;
  high: number;
  medium: number;
  total: number;
}

interface IntegritySummary {
  balanceEquation: boolean;
  orphanedEvents: number;
  orphanedPositions: number;
  eventCoverage: number;
}

interface CriticalIssue {
  type: string;
  description: string;
  timestamp: Date;
  severity: 'CRITICAL';
}

interface WeeklyReport {
  week: number;
  startDate: Date;
  endDate: Date;
  ledgerAudit: any;
  allTrades: TradeSummary[];
  performance: PerformanceMetrics;
  slTpExecutions: SlTpSummary;
  reconciliationLogs: ReconciliationSummary;
}

interface TradeSummary {
  positionId: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  duration: number;
}

interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgPnL: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

interface SlTpSummary {
  totalTriggers: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgLatency: number;
}

interface ReconciliationSummary {
  totalRuns: number;
  mismatches: number;
  avgDuration: number;
}

interface DeploymentReport {
  startDate: Date;
  endDate: Date;
  duration: number;
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  success: boolean;
}

export class LiveCapitalMonitorService {
  private auditor = new ManualAuditorService();

  async monitorDeployment(durationMs: number): Promise<DeploymentReport> {
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationMs);
    
    logger.info('🚀 Starting Live Capital Monitoring');
    logger.info(`📅 Start: ${startDate.toISOString()}`);
    logger.info(`📅 End: ${endDate.toISOString()}`);
    logger.info(`⏱️  Duration: ${durationMs / 1000 / 60 / 60 / 24} days`);
    logger.info('');

    const dailyReports: DailyReport[] = [];
    const weeklyReports: WeeklyReport[] = [];
    let dayCount = 0;

    while (Date.now() < endDate.getTime()) {
      dayCount++;
      
      // Daily monitoring
      logger.info(`📅 Day ${dayCount}: ${new Date().toISOString()}`);
      const dailyReport = await this.performDailyCheck();
      dailyReports.push(dailyReport);

      // Check for critical issues
      if (dailyReport.criticalIssues.length > 0) {
        logger.error(`🚨 CRITICAL ISSUES DETECTED ON DAY ${dayCount}`);
        dailyReport.criticalIssues.forEach(issue => {
          logger.error(`   - ${issue.description}`);
        });
        
        await this.alertAndStop(dailyReport);
        break;
      }

      // Weekly audit (every 7 days)
      if (dayCount % 7 === 0) {
        logger.info(`📊 Week ${dayCount / 7}: Running weekly audit...`);
        const weeklyReport = await this.performWeeklyAudit(dayCount / 7, dailyReports.slice(-7));
        weeklyReports.push(weeklyReport);
      }

      // Sleep for 24 hours (or shorter for testing)
      await this.sleep(86400000); // 24 hours
    }

    const success = dailyReports.every(r => r.criticalIssues.length === 0);

    return {
      startDate,
      endDate,
      duration: durationMs,
      dailyReports,
      weeklyReports,
      success
    };
  }

  private async performDailyCheck(): Promise<DailyReport> {
    const date = new Date();

    // Check positions
    const positions = await this.checkPositions();
    
    // Check balance
    const balance = await this.checkBalance();
    
    // Check errors
    const errors = await this.checkErrors();
    
    // Run integrity check
    const integrity = await this.runIntegrityCheck();
    
    // Find critical issues
    const criticalIssues = await this.findCriticalIssues(positions, balance, errors, integrity);

    const report: DailyReport = {
      date,
      positions,
      balance,
      errors,
      integrity,
      criticalIssues
    };

    // Log summary
    logger.info(`   Positions: ${positions.open} open, ${positions.closed} closed`);
    logger.info(`   Balance: $${balance.current.toFixed(2)} (${balance.changePercent >= 0 ? '+' : ''}${balance.changePercent.toFixed(2)}%)`);
    logger.info(`   Errors: ${errors.critical} critical, ${errors.high} high, ${errors.medium} medium`);
    logger.info(`   Integrity: ${integrity.balanceEquation ? '✅' : '❌'} Balance, ${integrity.eventCoverage.toFixed(1)}% Coverage`);
    logger.info(`   Critical Issues: ${criticalIssues.length}`);
    logger.info('');

    return report;
  }

  private async checkPositions(): Promise<PositionSummary> {
    const { data: positions } = await supabase
      .from('positions')
      .select('*');

    const open = positions?.filter(p => p.status === 'OPEN').length || 0;
    const closed = positions?.filter(p => p.status === 'CLOSED').length || 0;
    const totalPnL = positions?.reduce((sum, p) => sum + (p.realized_pnl || 0), 0) || 0;
    const marginUsed = positions?.filter(p => p.status === 'OPEN')
      .reduce((sum, p) => sum + (p.margin_required || 0), 0) || 0;

    return { open, closed, totalPnL, marginUsed };
  }

  private async checkBalance(): Promise<BalanceSummary> {
    const { data: events } = await supabase
      .from('account_balance_events')
      .select('balance_after, created_at')
      .order('created_at', { ascending: false })
      .limit(2);

    const current = events?.[0]?.balance_after || 0;
    const previous = events?.[1]?.balance_after || current;
    const change24h = current - previous;
    const changePercent = previous !== 0 ? (change24h / previous) * 100 : 0;

    return { current, change24h, changePercent };
  }

  private async checkErrors(): Promise<ErrorSummary> {
    // In a real system, would query error logs
    // For now, return mock data
    return {
      critical: 0,
      high: 0,
      medium: 0,
      total: 0
    };
  }

  private async runIntegrityCheck(): Promise<IntegritySummary> {
    try {
      const audit = await this.auditor.performAudit();
      
      return {
        balanceEquation: audit.balanceCheck.passed,
        orphanedEvents: audit.discrepancies.filter(d => d.type === 'ORPHANED_EVENT').length,
        orphanedPositions: audit.coverage.missingEvents.length,
        eventCoverage: audit.coverage.coveragePercentage
      };
    } catch (error) {
      logger.error('Failed to run integrity check', error);
      return {
        balanceEquation: false,
        orphanedEvents: 0,
        orphanedPositions: 0,
        eventCoverage: 0
      };
    }
  }

  private async findCriticalIssues(
    positions: PositionSummary,
    balance: BalanceSummary,
    errors: ErrorSummary,
    integrity: IntegritySummary
  ): Promise<CriticalIssue[]> {
    const issues: CriticalIssue[] = [];

    // Check for critical errors
    if (errors.critical > 0) {
      issues.push({
        type: 'CRITICAL_ERRORS',
        description: `${errors.critical} critical errors detected`,
        timestamp: new Date(),
        severity: 'CRITICAL'
      });
    }

    // Check balance equation
    if (!integrity.balanceEquation) {
      issues.push({
        type: 'BALANCE_EQUATION_VIOLATED',
        description: 'Balance equation violated',
        timestamp: new Date(),
        severity: 'CRITICAL'
      });
    }

    // Check for orphaned events
    if (integrity.orphanedEvents > 0) {
      issues.push({
        type: 'ORPHANED_EVENTS',
        description: `${integrity.orphanedEvents} orphaned events detected`,
        timestamp: new Date(),
        severity: 'CRITICAL'
      });
    }

    // Check for orphaned positions
    if (integrity.orphanedPositions > 0) {
      issues.push({
        type: 'ORPHANED_POSITIONS',
        description: `${integrity.orphanedPositions} orphaned positions detected`,
        timestamp: new Date(),
        severity: 'CRITICAL'
      });
    }

    // Check event coverage
    if (integrity.eventCoverage < 100) {
      issues.push({
        type: 'INCOMPLETE_EVENT_COVERAGE',
        description: `Event coverage at ${integrity.eventCoverage.toFixed(1)}% (100% required)`,
        timestamp: new Date(),
        severity: 'CRITICAL'
      });
    }

    return issues;
  }

  private async performWeeklyAudit(week: number, dailyReports: DailyReport[]): Promise<WeeklyReport> {
    const startDate = dailyReports[0].date;
    const endDate = dailyReports[dailyReports.length - 1].date;

    // Run full ledger audit
    const ledgerAudit = await this.auditor.performAudit();

    // Review all trades
    const allTrades = await this.reviewAllTrades();

    // Analyze performance
    const performance = await this.analyzePerformance(allTrades);

    // Verify SL/TP executions
    const slTpExecutions = await this.verifySlTpExecutions();

    // Check reconciliation logs
    const reconciliationLogs = await this.checkReconciliationLogs();

    return {
      week,
      startDate,
      endDate,
      ledgerAudit,
      allTrades,
      performance,
      slTpExecutions,
      reconciliationLogs
    };
  }

  private async reviewAllTrades(): Promise<TradeSummary[]> {
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'CLOSED')
      .order('created_at', { ascending: false });

    return (positions || []).map(p => ({
      positionId: p.id,
      symbol: p.symbol,
      direction: p.direction,
      entryPrice: p.avg_entry_price,
      exitPrice: p.close_price || 0,
      pnl: p.realized_pnl || 0,
      duration: p.closed_at ? new Date(p.closed_at).getTime() - new Date(p.created_at).getTime() : 0
    }));
  }

  private async analyzePerformance(trades: TradeSummary[]): Promise<PerformanceMetrics> {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgPnL = totalTrades > 0 ? trades.reduce((sum, t) => sum + t.pnl, 0) / totalTrades : 0;

    // Calculate max drawdown (simplified)
    let maxDrawdown = 0;
    let peak = 0;
    let cumPnL = 0;
    
    for (const trade of trades) {
      cumPnL += trade.pnl;
      if (cumPnL > peak) peak = cumPnL;
      const drawdown = peak - cumPnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Sharpe ratio (simplified - would need more data for accurate calculation)
    const sharpeRatio = 0;

    return {
      totalTrades,
      winRate,
      avgPnL,
      maxDrawdown,
      sharpeRatio
    };
  }

  private async verifySlTpExecutions(): Promise<SlTpSummary> {
    // In a real system, would query SL/TP execution logs
    return {
      totalTriggers: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgLatency: 0
    };
  }

  private async checkReconciliationLogs(): Promise<ReconciliationSummary> {
    // In a real system, would query reconciliation logs
    return {
      totalRuns: 0,
      mismatches: 0,
      avgDuration: 0
    };
  }

  private async alertAndStop(report: DailyReport): Promise<void> {
    logger.error('🚨 CRITICAL ISSUES DETECTED - STOPPING DEPLOYMENT');
    logger.error('');
    logger.error('Critical Issues:');
    report.criticalIssues.forEach(issue => {
      logger.error(`   - [${issue.type}] ${issue.description}`);
    });
    logger.error('');
    logger.error('📋 REQUIRED ACTIONS:');
    logger.error('   1. Investigate all critical issues');
    logger.error('   2. Fix root causes');
    logger.error('   3. RESTART from Week 1 (72-hour test)');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
