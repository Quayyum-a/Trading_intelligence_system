import { logger } from '../config/logger.js';
import type { StrategyConfig, EngineStatus } from './strategy.types.js';
import {
  StrategyMonitoringService,
  type StrategyMetrics,
  type DecisionQualityAnalysis,
} from './strategy-monitoring.service.js';
import {
  StrategyHealthChecker,
  type SystemHealthReport,
} from './strategy-health-checker.js';

/**
 * Strategy Metrics Dashboard
 *
 * Provides formatted metrics and analytics for strategy engine monitoring
 * Requirements: 6.1, 6.2, 6.3, 8.1
 */

export interface DashboardMetrics {
  overview: {
    status: 'healthy' | 'warning' | 'critical';
    uptime: string;
    totalDecisions: number;
    signalRate: number;
    avgConfidence: number;
    lastUpdate: Date;
  };
  performance: {
    avgDecisionTime: string;
    memoryUsage: string;
    decisionsPerMinute: number;
    throughput: string;
  };
  quality: {
    confidenceDistribution: Array<{
      range: string;
      count: number;
      percentage: number;
      color: string;
    }>;
    regimeBreakdown: Array<{
      regime: string;
      count: number;
      percentage: number;
      color: string;
    }>;
    qualityScore: number;
    qualityTrend: 'improving' | 'stable' | 'declining';
  };
  alerts: {
    active: number;
    critical: number;
    high: number;
    recent: Array<{
      type: string;
      severity: string;
      message: string;
      timestamp: Date;
      age: string;
    }>;
  };
  health: {
    components: Array<{
      name: string;
      status: 'healthy' | 'warning' | 'critical';
      message: string;
      statusIcon: string;
    }>;
    recommendations: string[];
  };
}

export interface AnalyticsReport {
  period: {
    start: Date;
    end: Date;
    duration: string;
  };
  summary: {
    totalDecisions: number;
    signalRate: number;
    avgConfidence: number;
    qualityTrend: 'improving' | 'stable' | 'declining';
    trendIcon: string;
  };
  charts: {
    confidenceDistribution: Array<{
      label: string;
      value: number;
      percentage: number;
      color: string;
    }>;
    regimeAnalysis: Array<{
      regime: string;
      decisions: number;
      signalRate: number;
      avgConfidence: number;
      color: string;
    }>;
    timeAnalysis: Array<{
      hour: number;
      decisions: number;
      avgConfidence: number;
      quality: 'high' | 'medium' | 'low';
    }>;
  };
  insights: {
    bestPerformingHours: number[];
    worstPerformingHours: number[];
    dominantRegime: string;
    qualityInsights: string[];
    recommendations: string[];
  };
}

export class StrategyMetricsDashboard {
  private monitoringService: StrategyMonitoringService;
  private healthChecker: StrategyHealthChecker;

  constructor() {
    this.monitoringService = new StrategyMonitoringService();
    this.healthChecker = new StrategyHealthChecker(this.monitoringService);
  }

  /**
   * Get formatted dashboard metrics
   */
  async getDashboardMetrics(
    engineStatus: EngineStatus,
    config: StrategyConfig
  ): Promise<DashboardMetrics> {
    try {
      const [metrics, healthReport] = await Promise.all([
        this.monitoringService.getMetrics(),
        this.healthChecker.runHealthCheck(engineStatus, config),
      ]);

      return {
        overview: this.formatOverviewMetrics(metrics, engineStatus),
        performance: this.formatPerformanceMetrics(metrics),
        quality: this.formatQualityMetrics(metrics),
        alerts: this.formatAlertMetrics(),
        health: this.formatHealthMetrics(healthReport),
      };
    } catch (error) {
      logger?.error('Failed to get dashboard metrics', { error });
      throw error;
    }
  }

  /**
   * Get analytics report for a time period
   */
  async getAnalyticsReport(
    startDate: Date,
    endDate: Date
  ): Promise<AnalyticsReport> {
    try {
      const analysis = await this.monitoringService.analyzeDecisionQuality(
        startDate,
        endDate
      );

      return {
        period: this.formatPeriod(startDate, endDate),
        summary: this.formatAnalyticsSummary(analysis),
        charts: this.formatAnalyticsCharts(analysis),
        insights: this.generateAnalyticsInsights(analysis),
      };
    } catch (error) {
      logger?.error('Failed to get analytics report', { error });
      throw error;
    }
  }

  /**
   * Get real-time status summary
   */
  async getStatusSummary(engineStatus: EngineStatus): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    message: string;
    details: {
      isRunning: boolean;
      lastActivity: string;
      errorCount: number;
      alertCount: number;
    };
    statusIcon: string;
    statusColor: string;
  }> {
    try {
      const activeAlerts = this.monitoringService.getActiveAlerts();
      const criticalAlerts = activeAlerts.filter(
        a => a.severity === 'critical'
      );

      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      let message = 'System operating normally';
      let statusIcon = '✅';
      let statusColor = '#10B981'; // green

      if (!engineStatus.isRunning) {
        status = 'critical';
        message = 'Strategy engine is not running';
        statusIcon = '❌';
        statusColor = '#EF4444'; // red
      } else if (criticalAlerts.length > 0) {
        status = 'critical';
        message = `${criticalAlerts.length} critical alerts active`;
        statusIcon = '🚨';
        statusColor = '#EF4444'; // red
      } else if (engineStatus.errors.length > 5 || activeAlerts.length > 3) {
        status = 'warning';
        message = 'System has warnings';
        statusIcon = '⚠️';
        statusColor = '#F59E0B'; // yellow
      }

      const lastActivity = engineStatus.lastProcessedCandle
        ? this.formatTimeAgo(engineStatus.lastProcessedCandle)
        : 'Never';

      return {
        status,
        message,
        details: {
          isRunning: engineStatus.isRunning,
          lastActivity,
          errorCount: engineStatus.errors.length,
          alertCount: activeAlerts.length,
        },
        statusIcon,
        statusColor,
      };
    } catch (error) {
      logger?.error('Failed to get status summary', { error });
      return {
        status: 'critical',
        message: 'Failed to get system status',
        details: {
          isRunning: false,
          lastActivity: 'Unknown',
          errorCount: 0,
          alertCount: 0,
        },
        statusIcon: '❌',
        statusColor: '#EF4444',
      };
    }
  }

  /**
   * Format overview metrics
   */
  private formatOverviewMetrics(
    metrics: StrategyMetrics,
    engineStatus: EngineStatus
  ) {
    const signalRate =
      metrics.decisionQuality.totalDecisions > 0
        ? (metrics.decisionQuality.tradeSignals /
            metrics.decisionQuality.totalDecisions) *
          100
        : 0;

    return {
      status: metrics.systemHealth.status,
      uptime: this.formatUptime(metrics.systemHealth.uptime),
      totalDecisions: metrics.decisionQuality.totalDecisions,
      signalRate: Math.round(signalRate * 10) / 10,
      avgConfidence:
        Math.round(metrics.decisionQuality.avgConfidenceScore * 1000) / 1000,
      lastUpdate: new Date(),
    };
  }

  /**
   * Format performance metrics
   */
  private formatPerformanceMetrics(metrics: StrategyMetrics) {
    return {
      avgDecisionTime: `${Math.round(metrics.performance.avgDecisionTimeMs)}ms`,
      memoryUsage: `${metrics.performance.memoryUsageMB}MB`,
      decisionsPerMinute:
        Math.round(metrics.performance.decisionsPerMinute * 10) / 10,
      throughput: `${metrics.performance.decisionsPerMinute.toFixed(1)}/min`,
    };
  }

  /**
   * Format quality metrics
   */
  private formatQualityMetrics(metrics: StrategyMetrics) {
    const confidenceColors = [
      '#EF4444',
      '#F59E0B',
      '#10B981',
      '#3B82F6',
      '#8B5CF6',
    ];
    const regimeColors = ['#10B981', '#EF4444', '#F59E0B', '#6B7280'];

    const confidenceDistribution = Object.entries(
      metrics.decisionQuality.confidenceDistribution
    ).map(([range, count], index) => ({
      range,
      count,
      percentage:
        metrics.decisionQuality.totalDecisions > 0
          ? (count / metrics.decisionQuality.totalDecisions) * 100
          : 0,
      color: confidenceColors[index] || '#6B7280',
    }));

    const regimeBreakdown = Object.entries(
      metrics.decisionQuality.regimeDistribution
    ).map(([regime, count], index) => ({
      regime,
      count,
      percentage:
        metrics.decisionQuality.totalDecisions > 0
          ? (count / metrics.decisionQuality.totalDecisions) * 100
          : 0,
      color: regimeColors[index] || '#6B7280',
    }));

    return {
      confidenceDistribution,
      regimeBreakdown,
      qualityScore: Math.round(
        metrics.decisionQuality.avgConfidenceScore * 100
      ),
      qualityTrend: 'stable' as const, // Would be calculated from historical data
    };
  }

  /**
   * Format alert metrics
   */
  private formatAlertMetrics() {
    const activeAlerts = this.monitoringService.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
    const highAlerts = activeAlerts.filter(a => a.severity === 'high');

    const recent = activeAlerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5)
      .map(alert => ({
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp,
        age: this.formatTimeAgo(alert.timestamp),
      }));

    return {
      active: activeAlerts.length,
      critical: criticalAlerts.length,
      high: highAlerts.length,
      recent,
    };
  }

  /**
   * Format health metrics
   */
  private formatHealthMetrics(healthReport: SystemHealthReport) {
    const components = healthReport.components.map(component => ({
      name: component.component
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase()),
      status: component.status,
      message: component.message,
      statusIcon: this.getStatusIcon(component.status),
    }));

    return {
      components,
      recommendations: healthReport.recommendations,
    };
  }

  /**
   * Format period information
   */
  private formatPeriod(startDate: Date, endDate: Date) {
    const duration = endDate.getTime() - startDate.getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    let durationStr = '';
    if (days > 0) {
      durationStr = `${days} day${days > 1 ? 's' : ''}`;
    } else {
      durationStr = `${hours} hour${hours > 1 ? 's' : ''}`;
    }

    return {
      start: startDate,
      end: endDate,
      duration: durationStr,
    };
  }

  /**
   * Format analytics summary
   */
  private formatAnalyticsSummary(analysis: DecisionQualityAnalysis) {
    const trendIcons = {
      improving: '📈',
      stable: '➡️',
      declining: '📉',
    };

    return {
      totalDecisions: analysis.summary.totalDecisions,
      signalRate: Math.round(analysis.summary.signalRate * 10) / 10,
      avgConfidence: Math.round(analysis.summary.avgConfidence * 1000) / 1000,
      qualityTrend: analysis.summary.qualityTrend,
      trendIcon: trendIcons[analysis.summary.qualityTrend],
    };
  }

  /**
   * Format analytics charts
   */
  private formatAnalyticsCharts(analysis: DecisionQualityAnalysis) {
    const confidenceColors = [
      '#EF4444',
      '#F59E0B',
      '#10B981',
      '#3B82F6',
      '#8B5CF6',
    ];
    const regimeColors = ['#10B981', '#EF4444', '#F59E0B', '#6B7280'];

    const confidenceDistribution = analysis.confidenceAnalysis.distribution.map(
      (item, index) => ({
        label: item.range,
        value: item.count,
        percentage: item.percentage,
        color: confidenceColors[index] || '#6B7280',
      })
    );

    const regimeAnalysis = analysis.regimeAnalysis.map((item, index) => ({
      regime: item.regime,
      decisions: item.decisions,
      signalRate: Math.round(item.signalRate * 10) / 10,
      avgConfidence: Math.round(item.avgConfidence * 1000) / 1000,
      color: regimeColors[index] || '#6B7280',
    }));

    const timeAnalysis = analysis.timeAnalysis.hourlyDistribution.map(item => ({
      hour: item.hour,
      decisions: item.decisions,
      avgConfidence: Math.round(item.avgConfidence * 1000) / 1000,
      quality:
        item.avgConfidence > 0.8
          ? ('high' as const)
          : item.avgConfidence > 0.6
            ? ('medium' as const)
            : ('low' as const),
    }));

    return {
      confidenceDistribution,
      regimeAnalysis,
      timeAnalysis,
    };
  }

  /**
   * Generate analytics insights
   */
  private generateAnalyticsInsights(analysis: DecisionQualityAnalysis) {
    const insights: string[] = [];
    const recommendations: string[] = [];

    // Quality insights
    if (analysis.summary.avgConfidence > 0.8) {
      insights.push(
        'High average confidence indicates strong decision quality'
      );
    } else if (analysis.summary.avgConfidence < 0.6) {
      insights.push(
        'Low average confidence suggests need for parameter tuning'
      );
      recommendations.push('Review strategy parameters and market conditions');
    }

    // Signal rate insights
    if (analysis.summary.signalRate < 5) {
      insights.push('Very low signal rate - strategy may be too conservative');
      recommendations.push('Consider relaxing confidence thresholds');
    } else if (analysis.summary.signalRate > 50) {
      insights.push('High signal rate - strategy may be too aggressive');
      recommendations.push('Consider tightening confidence thresholds');
    }

    // Regime insights
    const dominantRegime = analysis.regimeAnalysis.reduce((max, current) =>
      current.decisions > max.decisions ? current : max
    );

    insights.push(`${dominantRegime.regime} was the dominant market regime`);

    // Time insights
    const bestHours = analysis.timeAnalysis.peakPerformanceHours;
    const worstHours = analysis.timeAnalysis.lowPerformanceHours;

    if (bestHours.length > 0) {
      insights.push(`Best performance during hours: ${bestHours.join(', ')}`);
    }

    if (worstHours.length > 0) {
      insights.push(
        `Lowest performance during hours: ${worstHours.join(', ')}`
      );
      recommendations.push(
        'Consider adjusting trading window to focus on peak hours'
      );
    }

    // Trend insights
    if (analysis.summary.qualityTrend === 'improving') {
      insights.push('Decision quality is improving over time');
    } else if (analysis.summary.qualityTrend === 'declining') {
      insights.push('Decision quality is declining - investigation needed');
      recommendations.push(
        'Analyze recent market conditions and strategy performance'
      );
    }

    return {
      bestPerformingHours: analysis.timeAnalysis.peakPerformanceHours,
      worstPerformingHours: analysis.timeAnalysis.lowPerformanceHours,
      dominantRegime: dominantRegime.regime,
      qualityInsights: insights,
      recommendations,
    };
  }

  /**
   * Format uptime
   */
  private formatUptime(uptimeSeconds: number): string {
    const days = Math.floor(uptimeSeconds / (24 * 60 * 60));
    const hours = Math.floor((uptimeSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((uptimeSeconds % (60 * 60)) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Format time ago
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: 'healthy' | 'warning' | 'critical'): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'critical':
        return '❌';
      default:
        return '❓';
    }
  }
}
