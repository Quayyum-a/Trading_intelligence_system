/**
 * Execution Reporting Service - Generate comprehensive execution reports and analytics
 */

import { ExecutionReporterService } from './execution-reporter.service';
import { AuditLoggerService } from './audit-logger.service';
import { PnLCalculatorService } from './pnl-calculator.service';
import { getSupabaseClient } from '../../config/supabase';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface ExecutionReport {
  id: string;
  reportType: ReportType;
  period: ReportPeriod;
  generatedAt: Date;
  data: any;
  summary: ReportSummary;
}

export enum ReportType {
  TRADE_SUMMARY = 'TRADE_SUMMARY',
  PERFORMANCE_ANALYSIS = 'PERFORMANCE_ANALYSIS',
  RISK_ANALYSIS = 'RISK_ANALYSIS',
  AUDIT_TRAIL = 'AUDIT_TRAIL',
  SYSTEM_HEALTH = 'SYSTEM_HEALTH',
  COMPLIANCE = 'COMPLIANCE',
  CUSTOM = 'CUSTOM'
}

export enum ReportPeriod {
  REAL_TIME = 'REAL_TIME',
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM = 'CUSTOM'
}

export interface ReportSummary {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalPnL: number;
  winRate: number;
  averageReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  keyMetrics: Record<string, number>;
  alerts: string[];
}

export interface TradeAnalysisReport {
  period: string;
  totalTrades: number;
  activeTrades: number;
  completedTrades: number;
  tradesByStatus: Record<string, number>;
  tradesBySymbol: Record<string, number>;
  tradesByTimeframe: Record<string, number>;
  averageTradeSize: number;
  averageHoldingTime: number;
  successRate: number;
  profitFactor: number;
  totalVolume: number;
}

export interface RiskAnalysisReport {
  period: string;
  maxRiskPerTrade: number;
  averageRiskPerTrade: number;
  totalRiskExposure: number;
  leverageUtilization: number;
  marginUtilization: number;
  riskViolations: number;
  riskDistribution: Record<string, number>;
  correlationAnalysis: Record<string, number>;
  stressTestResults: Record<string, any>;
}

export interface SystemHealthReport {
  timestamp: Date;
  systemStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  uptime: number;
  brokerConnections: Record<string, boolean>;
  databaseHealth: boolean;
  errorRate: number;
  averageResponseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
  queueSizes: Record<string, number>;
  alerts: string[];
}

export class ExecutionReportingService {
  constructor(
    private executionReporter: ExecutionReporterService,
    private auditLogger: AuditLoggerService,
    private pnlCalculator: PnLCalculatorService
  ) {}

  /**
   * Generate comprehensive trade analysis report
   */
  async generateTradeAnalysisReport(
    period: ReportPeriod,
    customRange?: { start: Date; end: Date }
  ): Promise<TradeAnalysisReport> {
    try {
      logger.info('Generating trade analysis report', { period, customRange });

      const timeframe = this.getTimeframe(period, customRange);
      
      // Get execution summary
      const executionSummary = await this.executionReporter.getExecutionSummary(timeframe);

      // Get additional trade data
      const { data: trades, error } = await supabase
        .from('execution_trades')
        .select('*')
        .gte('created_at', timeframe.start.toISOString())
        .lte('created_at', timeframe.end.toISOString());

      if (error) {
        throw new Error(`Failed to get trades for analysis: ${error.message}`);
      }

      const allTrades = trades || [];

      // Analyze trades by symbol
      const tradesBySymbol: Record<string, number> = {};
      allTrades.forEach(trade => {
        tradesBySymbol[trade.pair] = (tradesBySymbol[trade.pair] || 0) + 1;
      });

      // Analyze trades by timeframe
      const tradesByTimeframe: Record<string, number> = {};
      allTrades.forEach(trade => {
        tradesByTimeframe[trade.timeframe] = (tradesByTimeframe[trade.timeframe] || 0) + 1;
      });

      // Calculate average trade size
      const averageTradeSize = allTrades.length > 0 
        ? allTrades.reduce((sum, trade) => sum + trade.position_size, 0) / allTrades.length 
        : 0;

      // Calculate total volume
      const totalVolume = allTrades.reduce((sum, trade) => sum + (trade.position_size * trade.entry_price), 0);

      // Calculate profit factor
      const winningTrades = allTrades.filter(t => t.close_reason === 'TP');
      const losingTrades = allTrades.filter(t => t.close_reason === 'SL');
      const profitFactor = losingTrades.length > 0 ? winningTrades.length / losingTrades.length : 0;

      const report: TradeAnalysisReport = {
        period: this.formatPeriod(period, customRange),
        totalTrades: executionSummary.totalTrades,
        activeTrades: executionSummary.activetrades,
        completedTrades: executionSummary.completedTrades,
        tradesByStatus: executionSummary.statusBreakdown,
        tradesBySymbol,
        tradesByTimeframe,
        averageTradeSize: Math.round(averageTradeSize * 100) / 100,
        averageHoldingTime: executionSummary.averageHoldingTime,
        successRate: executionSummary.successRate,
        profitFactor: Math.round(profitFactor * 100) / 100,
        totalVolume: Math.round(totalVolume * 100) / 100
      };

      logger.info('Trade analysis report generated', {
        period,
        totalTrades: report.totalTrades,
        successRate: report.successRate
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate trade analysis report', {
        period,
        customRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate risk analysis report
   */
  async generateRiskAnalysisReport(
    period: ReportPeriod,
    customRange?: { start: Date; end: Date }
  ): Promise<RiskAnalysisReport> {
    try {
      logger.info('Generating risk analysis report', { period, customRange });

      const timeframe = this.getTimeframe(period, customRange);

      // Get trades in the period
      const { data: trades, error } = await supabase
        .from('execution_trades')
        .select('*')
        .gte('created_at', timeframe.start.toISOString())
        .lte('created_at', timeframe.end.toISOString());

      if (error) {
        throw new Error(`Failed to get trades for risk analysis: ${error.message}`);
      }

      const allTrades = trades || [];

      // Calculate risk metrics
      const riskPercentages = allTrades.map(t => t.risk_percent);
      const maxRiskPerTrade = Math.max(...riskPercentages, 0);
      const averageRiskPerTrade = riskPercentages.length > 0 
        ? riskPercentages.reduce((sum, risk) => sum + risk, 0) / riskPercentages.length 
        : 0;

      // Calculate total risk exposure (sum of all open positions)
      const openTrades = allTrades.filter(t => t.status === 'OPEN');
      const totalRiskExposure = openTrades.reduce((sum, trade) => sum + trade.risk_percent, 0);

      // Calculate leverage utilization
      const leverages = allTrades.map(t => t.leverage);
      const averageLeverage = leverages.length > 0 
        ? leverages.reduce((sum, lev) => sum + lev, 0) / leverages.length 
        : 0;
      const leverageUtilization = (averageLeverage / 200) * 100; // Assuming max leverage is 200

      // Calculate margin utilization (simplified)
      const marginUtilization = totalRiskExposure * 10; // Simplified calculation

      // Count risk violations (trades exceeding 1% risk)
      const riskViolations = allTrades.filter(t => t.risk_percent > 0.01).length;

      // Risk distribution by percentage ranges
      const riskDistribution: Record<string, number> = {
        '0-0.5%': allTrades.filter(t => t.risk_percent <= 0.005).length,
        '0.5-1%': allTrades.filter(t => t.risk_percent > 0.005 && t.risk_percent <= 0.01).length,
        '>1%': allTrades.filter(t => t.risk_percent > 0.01).length
      };

      // Correlation analysis (simplified)
      const correlationAnalysis: Record<string, number> = {
        'risk_vs_return': this.calculateCorrelation(allTrades, 'risk_percent', 'rr'),
        'leverage_vs_success': this.calculateLeverageSuccessCorrelation(allTrades)
      };

      // Stress test results (simplified)
      const stressTestResults = {
        worstCaseScenario: this.calculateWorstCaseScenario(allTrades),
        maxDrawdownPotential: this.calculateMaxDrawdownPotential(allTrades),
        liquidationRisk: this.calculateLiquidationRisk(allTrades)
      };

      const report: RiskAnalysisReport = {
        period: this.formatPeriod(period, customRange),
        maxRiskPerTrade: Math.round(maxRiskPerTrade * 10000) / 100, // Convert to percentage
        averageRiskPerTrade: Math.round(averageRiskPerTrade * 10000) / 100,
        totalRiskExposure: Math.round(totalRiskExposure * 10000) / 100,
        leverageUtilization: Math.round(leverageUtilization * 100) / 100,
        marginUtilization: Math.round(marginUtilization * 100) / 100,
        riskViolations,
        riskDistribution,
        correlationAnalysis,
        stressTestResults
      };

      logger.info('Risk analysis report generated', {
        period,
        maxRiskPerTrade: report.maxRiskPerTrade,
        riskViolations: report.riskViolations
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate risk analysis report', {
        period,
        customRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate system health report
   */
  async generateSystemHealthReport(): Promise<SystemHealthReport> {
    try {
      logger.info('Generating system health report');

      // Get system metrics (in a real implementation, these would come from monitoring systems)
      const systemStatus = await this.assessSystemStatus();
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB

      // Check broker connections (simplified)
      const brokerConnections = {
        'PAPER': true, // Assume paper broker is always available
        'MT5': false,  // Not implemented yet
        'REST': false  // Not implemented yet
      };

      // Check database health
      const databaseHealth = await this.checkDatabaseHealth();

      // Get error rate from recent audit logs
      const errorRate = await this.calculateRecentErrorRate();

      // Calculate average response time (simplified)
      const averageResponseTime = 150; // ms - would be calculated from actual metrics

      const alerts: string[] = [];
      
      // Generate alerts based on health metrics
      if (errorRate > 5) {
        alerts.push(`High error rate detected: ${errorRate}%`);
      }
      if (memoryUsage > 500) {
        alerts.push(`High memory usage: ${memoryUsage.toFixed(2)} MB`);
      }
      if (averageResponseTime > 1000) {
        alerts.push(`High response time: ${averageResponseTime} ms`);
      }

      const report: SystemHealthReport = {
        timestamp: new Date(),
        systemStatus,
        uptime: Math.round(uptime),
        brokerConnections,
        databaseHealth,
        errorRate: Math.round(errorRate * 100) / 100,
        averageResponseTime,
        memoryUsage: Math.round(memoryUsage * 100) / 100,
        cpuUsage: 0, // Would be calculated from system metrics
        activeConnections: 1, // Simplified
        queueSizes: {
          'execution_queue': 0,
          'audit_queue': 0
        },
        alerts
      };

      logger.info('System health report generated', {
        systemStatus: report.systemStatus,
        errorRate: report.errorRate,
        alertsCount: report.alerts.length
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate system health report', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    period: ReportPeriod,
    customRange?: { start: Date; end: Date }
  ): Promise<{
    period: string;
    totalTrades: number;
    riskCompliance: {
      compliantTrades: number;
      violations: number;
      complianceRate: number;
    };
    leverageCompliance: {
      compliantTrades: number;
      violations: number;
      complianceRate: number;
    };
    auditTrailCompleteness: number;
    regulatoryAlerts: string[];
  }> {
    try {
      logger.info('Generating compliance report', { period, customRange });

      const timeframe = this.getTimeframe(period, customRange);

      // Get trades in the period
      const { data: trades, error } = await supabase
        .from('execution_trades')
        .select('*')
        .gte('created_at', timeframe.start.toISOString())
        .lte('created_at', timeframe.end.toISOString());

      if (error) {
        throw new Error(`Failed to get trades for compliance report: ${error.message}`);
      }

      const allTrades = trades || [];

      // Risk compliance analysis
      const riskCompliantTrades = allTrades.filter(t => t.risk_percent <= 0.01);
      const riskViolations = allTrades.length - riskCompliantTrades.length;
      const riskComplianceRate = allTrades.length > 0 ? (riskCompliantTrades.length / allTrades.length) * 100 : 100;

      // Leverage compliance analysis
      const leverageCompliantTrades = allTrades.filter(t => t.leverage <= 200);
      const leverageViolations = allTrades.length - leverageCompliantTrades.length;
      const leverageComplianceRate = allTrades.length > 0 ? (leverageCompliantTrades.length / allTrades.length) * 100 : 100;

      // Audit trail completeness (simplified check)
      const auditTrailCompleteness = 100; // Would be calculated by checking audit records

      // Generate regulatory alerts
      const regulatoryAlerts: string[] = [];
      if (riskComplianceRate < 95) {
        regulatoryAlerts.push(`Risk compliance below threshold: ${riskComplianceRate.toFixed(2)}%`);
      }
      if (leverageComplianceRate < 100) {
        regulatoryAlerts.push(`Leverage violations detected: ${leverageViolations} trades`);
      }

      const report = {
        period: this.formatPeriod(period, customRange),
        totalTrades: allTrades.length,
        riskCompliance: {
          compliantTrades: riskCompliantTrades.length,
          violations: riskViolations,
          complianceRate: Math.round(riskComplianceRate * 100) / 100
        },
        leverageCompliance: {
          compliantTrades: leverageCompliantTrades.length,
          violations: leverageViolations,
          complianceRate: Math.round(leverageComplianceRate * 100) / 100
        },
        auditTrailCompleteness,
        regulatoryAlerts
      };

      logger.info('Compliance report generated', {
        period,
        totalTrades: report.totalTrades,
        riskComplianceRate: report.riskCompliance.complianceRate,
        leverageComplianceRate: report.leverageCompliance.complianceRate
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate compliance report', {
        period,
        customRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Export report to various formats
   */
  async exportReport(
    report: any,
    format: 'JSON' | 'CSV' | 'PDF' | 'EXCEL'
  ): Promise<{
    data: string | Buffer;
    filename: string;
    mimeType: string;
  }> {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      
      switch (format) {
        case 'JSON':
          return {
            data: JSON.stringify(report, null, 2),
            filename: `execution_report_${timestamp}.json`,
            mimeType: 'application/json'
          };
        
        case 'CSV':
          const csvData = this.convertToCSV(report);
          return {
            data: csvData,
            filename: `execution_report_${timestamp}.csv`,
            mimeType: 'text/csv'
          };
        
        default:
          throw new Error(`Export format ${format} not yet implemented`);
      }

    } catch (error) {
      logger.error('Failed to export report', {
        format,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private getTimeframe(period: ReportPeriod, customRange?: { start: Date; end: Date }): { start: Date; end: Date } {
    if (customRange) {
      return customRange;
    }

    const end = new Date();
    const start = new Date();

    switch (period) {
      case ReportPeriod.HOURLY:
        start.setHours(start.getHours() - 1);
        break;
      case ReportPeriod.DAILY:
        start.setDate(start.getDate() - 1);
        break;
      case ReportPeriod.WEEKLY:
        start.setDate(start.getDate() - 7);
        break;
      case ReportPeriod.MONTHLY:
        start.setMonth(start.getMonth() - 1);
        break;
      case ReportPeriod.QUARTERLY:
        start.setMonth(start.getMonth() - 3);
        break;
      case ReportPeriod.YEARLY:
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setDate(start.getDate() - 1);
    }

    return { start, end };
  }

  private formatPeriod(period: ReportPeriod, customRange?: { start: Date; end: Date }): string {
    if (customRange) {
      return `${customRange.start.toISOString().split('T')[0]} to ${customRange.end.toISOString().split('T')[0]}`;
    }
    return period.toLowerCase();
  }

  private calculateCorrelation(trades: any[], field1: string, field2: string): number {
    if (trades.length < 2) return 0;
    
    const values1 = trades.map(t => t[field1]).filter(v => v != null);
    const values2 = trades.map(t => t[field2]).filter(v => v != null);
    
    if (values1.length !== values2.length || values1.length < 2) return 0;
    
    // Simplified correlation calculation
    const mean1 = values1.reduce((sum, v) => sum + v, 0) / values1.length;
    const mean2 = values2.reduce((sum, v) => sum + v, 0) / values2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < values1.length; i++) {
      const diff1 = values1[i] - mean1;
      const diff2 = values2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private calculateLeverageSuccessCorrelation(trades: any[]): number {
    // Simplified calculation of correlation between leverage and success
    const successfulTrades = trades.filter(t => t.close_reason === 'TP');
    const avgLeverageSuccess = successfulTrades.length > 0 
      ? successfulTrades.reduce((sum, t) => sum + t.leverage, 0) / successfulTrades.length 
      : 0;
    
    const failedTrades = trades.filter(t => t.close_reason === 'SL');
    const avgLeverageFailed = failedTrades.length > 0 
      ? failedTrades.reduce((sum, t) => sum + t.leverage, 0) / failedTrades.length 
      : 0;
    
    return avgLeverageSuccess - avgLeverageFailed;
  }

  private calculateWorstCaseScenario(trades: any[]): number {
    // Calculate potential loss if all open trades hit stop loss
    const openTrades = trades.filter(t => t.status === 'OPEN');
    return openTrades.reduce((sum, trade) => {
      const potentialLoss = Math.abs(trade.entry_price - trade.stop_loss) * trade.position_size;
      return sum + potentialLoss;
    }, 0);
  }

  private calculateMaxDrawdownPotential(trades: any[]): number {
    // Simplified max drawdown calculation
    return trades.reduce((sum, trade) => sum + trade.risk_percent, 0) * 100;
  }

  private calculateLiquidationRisk(trades: any[]): number {
    // Simplified liquidation risk calculation based on leverage
    const highLeverageTrades = trades.filter(t => t.leverage > 100);
    return (highLeverageTrades.length / trades.length) * 100;
  }

  private async assessSystemStatus(): Promise<'HEALTHY' | 'WARNING' | 'CRITICAL'> {
    // Simplified system status assessment
    const errorRate = await this.calculateRecentErrorRate();
    
    if (errorRate > 10) return 'CRITICAL';
    if (errorRate > 5) return 'WARNING';
    return 'HEALTHY';
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('execution_trades').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }

  private async calculateRecentErrorRate(): Promise<number> {
    // Simplified error rate calculation
    // In a real implementation, this would query audit logs for recent errors
    return 2.5; // Mock 2.5% error rate
  }

  private convertToCSV(data: any): string {
    // Simplified CSV conversion
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      
      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(',')];
      
      for (const row of data) {
        const values = headers.map(header => {
          const value = row[header];
          return typeof value === 'string' ? `"${value}"` : value;
        });
        csvRows.push(values.join(','));
      }
      
      return csvRows.join('\n');
    } else {
      // Convert object to CSV
      const rows = Object.entries(data).map(([key, value]) => `"${key}","${value}"`);
      return 'Key,Value\n' + rows.join('\n');
    }
  }
}