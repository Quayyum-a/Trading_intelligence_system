import { logger } from '../config/logger.js';
import type {
  StrategyDecision,
  MarketRegime,
  DecisionType,
  StrategyConfig,
  EngineStatus
} from './strategy.types.js';
import { StrategyDecisionRepository } from '../repositories/strategy-decision.repository.js';
import { TradeSignalRepository } from '../repositories/trade-signal.repository.js';
import { StrategyAuditRepository } from '../repositories/strategy-audit.repository.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

/**
 * Strategy Monitoring Service
 * 
 * Implements comprehensive monitoring and metrics collection for the strategy engine
 * Requirements: 6.1, 6.2, 6.3, 8.1
 */

export interface StrategyMetrics {
  performance: {
    avgDecisionTimeMs: number;
    decisionsPerMinute: number;
    memoryUsageMB: number;
    cpuUsagePercent?: number;
  };
  decisionQuality: {
    totalDecisions: number;
    tradeSignals: number;
    noTradeDecisions: number;
    avgConfidenceScore: number;
    confidenceDistribution: Record<string, number>;
    regimeDistribution: Record<MarketRegime, number>;
  };
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    errorRate: number;
    lastError?: string;
    alertsActive: number;
  };
  auditCompliance: {
    auditLogCompleteness: number; // percentage
    decisionTraceability: number; // percentage
    dataIntegrityScore: number; // 0-1
  };
}

export interface PerformanceAlert {
  id: string;
  type: 'performance' | 'quality' | 'system' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
}

export interface DecisionQualityAnalysis {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalDecisions: number;
    signalRate: number; // percentage of decisions that generated signals
    avgConfidence: number;
    qualityTrend: 'improving' | 'stable' | 'declining';
  };
  regimeAnalysis: {
    regime: MarketRegime;
    decisions: number;
    signalRate: number;
    avgConfidence: number;
  }[];
  confidenceAnalysis: {
    distribution: { range: string; count: number; percentage: number }[];
    lowConfidenceRate: number; // percentage below threshold
    qualityScore: number; // 0-1
  };
  timeAnalysis: {
    hourlyDistribution: { hour: number; decisions: number; avgConfidence: number }[];
    peakPerformanceHours: number[];
    lowPerformanceHours: number[];
  };
}

export class StrategyMonitoringService {
  private decisionRepository: StrategyDecisionRepository;
  private signalRepository: TradeSignalRepository;
  private auditRepository: StrategyAuditRepository;
  
  private metrics: StrategyMetrics;
  private alerts: PerformanceAlert[] = [];
  private startTime: Date;
  private lastMetricsUpdate: Date;
  
  private readonly maxAlertsHistory = 100;
  private readonly metricsUpdateIntervalMs = 60000; // 1 minute

  constructor() {
    this.decisionRepository = new StrategyDecisionRepository();
    this.signalRepository = new TradeSignalRepository();
    this.auditRepository = new StrategyAuditRepository();
    
    this.startTime = new Date();
    this.lastMetricsUpdate = new Date();
    
    this.metrics = this.initializeMetrics();
    
    // Start periodic metrics collection
    this.startMetricsCollection();
  }

  /**
   * Get current strategy metrics
   */
  async getMetrics(): Promise<StrategyMetrics> {
    await this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Analyze decision quality over a time period
   */
  async analyzeDecisionQuality(
    startDate: Date,
    endDate: Date
  ): Promise<DecisionQualityAnalysis> {
    logger.info('Analyzing decision quality', { startDate, endDate });

    try {
      // Get all decisions in the period
      const decisions = await this.decisionRepository.getDecisionsByDateRange(
        startDate,
        endDate
      );

      if (decisions.length === 0) {
        return this.createEmptyQualityAnalysis(startDate, endDate);
      }

      // Calculate summary metrics
      const signalDecisions = decisions.filter(d => d.decision !== 'NO_TRADE');
      const signalRate = (signalDecisions.length / decisions.length) * 100;
      const avgConfidence = decisions.reduce((sum, d) => sum + d.confidenceScore, 0) / decisions.length;

      // Analyze regime distribution
      const regimeGroups = this.groupByRegime(decisions);
      const regimeAnalysis = Object.entries(regimeGroups).map(([regime, regimeDecisions]) => ({
        regime: regime as MarketRegime,
        decisions: regimeDecisions.length,
        signalRate: (regimeDecisions.filter(d => d.decision !== 'NO_TRADE').length / regimeDecisions.length) * 100,
        avgConfidence: regimeDecisions.reduce((sum, d) => sum + d.confidenceScore, 0) / regimeDecisions.length
      }));

      // Analyze confidence distribution
      const confidenceAnalysis = this.analyzeConfidenceDistribution(decisions);

      // Analyze time patterns
      const timeAnalysis = this.analyzeTimePatterns(decisions);

      // Determine quality trend (simplified - compare with previous period)
      const qualityTrend = await this.determineQualityTrend(startDate, endDate, avgConfidence);

      return {
        period: { start: startDate, end: endDate },
        summary: {
          totalDecisions: decisions.length,
          signalRate,
          avgConfidence,
          qualityTrend
        },
        regimeAnalysis,
        confidenceAnalysis,
        timeAnalysis
      };

    } catch (error) {
      logger.error('Failed to analyze decision quality', { error });
      throw error;
    }
  }

  /**
   * Monitor strategy health and generate alerts
   */
  async monitorHealth(engineStatus: EngineStatus, config: StrategyConfig): Promise<void> {
    try {
      // Check performance metrics
      await this.checkPerformanceHealth();
      
      // Check decision quality
      await this.checkDecisionQualityHealth(config);
      
      // Check system health
      this.checkSystemHealth(engineStatus);
      
      // Check audit compliance
      await this.checkAuditCompliance();
      
      // Update overall health status
      this.updateHealthStatus();
      
    } catch (error) {
      logger.error('Health monitoring failed', { error });
      this.createAlert('system', 'high', 'Health monitoring system failure', { error });
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Get all alerts (including resolved)
   */
  getAllAlerts(): PerformanceAlert[] {
    return [...this.alerts];
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      logger.info('Alert resolved', { alertId, type: alert.type, severity: alert.severity });
      return true;
    }
    return false;
  }

  /**
   * Clear all resolved alerts
   */
  clearResolvedAlerts(): number {
    const resolvedCount = this.alerts.filter(a => a.resolved).length;
    this.alerts = this.alerts.filter(a => !a.resolved);
    logger.info('Cleared resolved alerts', { count: resolvedCount });
    return resolvedCount;
  }

  /**
   * Record decision processing metrics
   */
  recordDecisionMetrics(decisionTimeMs: number, decision: StrategyDecision): void {
    // Update performance metrics
    this.updatePerformanceMetrics(decisionTimeMs);
    
    // Update decision quality metrics
    this.updateDecisionQualityMetrics(decision);
    
    // Check for performance alerts
    this.checkDecisionPerformance(decisionTimeMs);
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): StrategyMetrics {
    return {
      performance: {
        avgDecisionTimeMs: 0,
        decisionsPerMinute: 0,
        memoryUsageMB: 0
      },
      decisionQuality: {
        totalDecisions: 0,
        tradeSignals: 0,
        noTradeDecisions: 0,
        avgConfidenceScore: 0,
        confidenceDistribution: {},
        regimeDistribution: {
          'BULLISH_TREND': 0,
          'BEARISH_TREND': 0,
          'RANGING': 0,
          'NO_TRADE': 0
        }
      },
      systemHealth: {
        status: 'healthy',
        uptime: 0,
        errorRate: 0,
        alertsActive: 0
      },
      auditCompliance: {
        auditLogCompleteness: 100,
        decisionTraceability: 100,
        dataIntegrityScore: 1.0
      }
    };
  }

  /**
   * Start periodic metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(async () => {
      try {
        await this.updateMetrics();
      } catch (error) {
        logger.error('Periodic metrics update failed', { error });
      }
    }, this.metricsUpdateIntervalMs);
  }

  /**
   * Update all metrics
   */
  private async updateMetrics(): Promise<void> {
    const now = new Date();
    
    // Update performance metrics
    const memoryUsage = process.memoryUsage();
    this.metrics.performance.memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    // Update system health
    this.metrics.systemHealth.uptime = Math.floor((now.getTime() - this.startTime.getTime()) / 1000);
    this.metrics.systemHealth.alertsActive = this.getActiveAlerts().length;
    
    // Update decision quality metrics from database
    await this.updateDecisionQualityFromDatabase();
    
    this.lastMetricsUpdate = now;
  }

  /**
   * Update decision quality metrics from database
   */
  private async updateDecisionQualityFromDatabase(): Promise<void> {
    try {
      // Get recent decisions (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentDecisions = await this.decisionRepository.getDecisionsByDateRange(
        oneHourAgo,
        new Date()
      );

      if (recentDecisions.length > 0) {
        this.metrics.decisionQuality.totalDecisions = recentDecisions.length;
        this.metrics.decisionQuality.tradeSignals = recentDecisions.filter(d => d.decision !== 'NO_TRADE').length;
        this.metrics.decisionQuality.noTradeDecisions = recentDecisions.filter(d => d.decision === 'NO_TRADE').length;
        
        const avgConfidence = recentDecisions.reduce((sum, d) => sum + d.confidenceScore, 0) / recentDecisions.length;
        this.metrics.decisionQuality.avgConfidenceScore = avgConfidence;
        
        // Update regime distribution
        const regimeGroups = this.groupByRegime(recentDecisions);
        Object.keys(this.metrics.decisionQuality.regimeDistribution).forEach(regime => {
          this.metrics.decisionQuality.regimeDistribution[regime as MarketRegime] = 
            regimeGroups[regime as MarketRegime]?.length || 0;
        });
        
        // Update confidence distribution
        this.metrics.decisionQuality.confidenceDistribution = this.calculateConfidenceDistribution(recentDecisions);
      }
    } catch (error) {
      logger.error('Failed to update decision quality metrics from database', { error });
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(decisionTimeMs: number): void {
    // Update average decision time (exponential moving average)
    const alpha = 0.1;
    this.metrics.performance.avgDecisionTimeMs = 
      this.metrics.performance.avgDecisionTimeMs * (1 - alpha) + decisionTimeMs * alpha;
  }

  /**
   * Update decision quality metrics
   */
  private updateDecisionQualityMetrics(decision: StrategyDecision): void {
    this.metrics.decisionQuality.totalDecisions++;
    
    if (decision.decision === 'NO_TRADE') {
      this.metrics.decisionQuality.noTradeDecisions++;
    } else {
      this.metrics.decisionQuality.tradeSignals++;
    }
    
    // Update average confidence (exponential moving average)
    const alpha = 0.1;
    this.metrics.decisionQuality.avgConfidenceScore = 
      this.metrics.decisionQuality.avgConfidenceScore * (1 - alpha) + decision.confidenceScore * alpha;
    
    // Update regime distribution
    this.metrics.decisionQuality.regimeDistribution[decision.regime]++;
  }

  /**
   * Check performance health
   */
  private async checkPerformanceHealth(): Promise<void> {
    const perfStats = performanceMonitor.getPerformanceStats();
    
    // Check average decision time
    if (this.metrics.performance.avgDecisionTimeMs > 1000) {
      this.createAlert(
        'performance',
        'high',
        'High decision processing time',
        { avgDecisionTimeMs: this.metrics.performance.avgDecisionTimeMs }
      );
    }
    
    // Check memory usage
    if (this.metrics.performance.memoryUsageMB > 512) {
      this.createAlert(
        'performance',
        this.metrics.performance.memoryUsageMB > 1024 ? 'critical' : 'medium',
        'High memory usage',
        { memoryUsageMB: this.metrics.performance.memoryUsageMB }
      );
    }
  }

  /**
   * Check decision quality health
   */
  private async checkDecisionQualityHealth(config: StrategyConfig): Promise<void> {
    // Check confidence score trends
    if (this.metrics.decisionQuality.avgConfidenceScore < config.confidence.minThreshold * 0.8) {
      this.createAlert(
        'quality',
        'medium',
        'Low average confidence score',
        { 
          avgConfidence: this.metrics.decisionQuality.avgConfidenceScore,
          threshold: config.confidence.minThreshold
        }
      );
    }
    
    // Check signal rate (should not be too low or too high)
    const signalRate = this.metrics.decisionQuality.totalDecisions > 0 
      ? (this.metrics.decisionQuality.tradeSignals / this.metrics.decisionQuality.totalDecisions) * 100
      : 0;
    
    if (signalRate < 5) {
      this.createAlert(
        'quality',
        'medium',
        'Very low signal generation rate',
        { signalRate }
      );
    } else if (signalRate > 50) {
      this.createAlert(
        'quality',
        'medium',
        'Unusually high signal generation rate',
        { signalRate }
      );
    }
  }

  /**
   * Check system health
   */
  private checkSystemHealth(engineStatus: EngineStatus): void {
    // Check if engine is running
    if (!engineStatus.isRunning) {
      this.createAlert(
        'system',
        'critical',
        'Strategy engine is not running',
        { status: engineStatus }
      );
    }
    
    // Check error rate
    if (engineStatus.errors.length > 10) {
      this.createAlert(
        'system',
        'high',
        'High error rate detected',
        { errorCount: engineStatus.errors.length, recentErrors: engineStatus.errors.slice(-5) }
      );
    }
  }

  /**
   * Check audit compliance
   */
  private async checkAuditCompliance(): Promise<void> {
    try {
      // Check audit log completeness for recent decisions
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentDecisions = await this.decisionRepository.getDecisionsByDateRange(
        oneHourAgo,
        new Date()
      );
      
      if (recentDecisions.length > 0) {
        // Check if all decisions have corresponding audit logs
        let auditCompleteCount = 0;
        
        for (const decision of recentDecisions) {
          const auditLogs = await this.auditRepository.getAuditLogsByDecisionId(decision.id);
          if (auditLogs.length >= 6) { // Should have logs for all stages
            auditCompleteCount++;
          }
        }
        
        const completeness = (auditCompleteCount / recentDecisions.length) * 100;
        this.metrics.auditCompliance.auditLogCompleteness = completeness;
        
        if (completeness < 95) {
          this.createAlert(
            'compliance',
            'high',
            'Incomplete audit logging detected',
            { completeness, missingAudits: recentDecisions.length - auditCompleteCount }
          );
        }
      }
    } catch (error) {
      logger.error('Audit compliance check failed', { error });
      this.createAlert(
        'compliance',
        'medium',
        'Audit compliance check failed',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Update overall health status
   */
  private updateHealthStatus(): void {
    const activeAlerts = this.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
    const highAlerts = activeAlerts.filter(a => a.severity === 'high');
    
    if (criticalAlerts.length > 0) {
      this.metrics.systemHealth.status = 'critical';
    } else if (highAlerts.length > 0 || activeAlerts.length > 5) {
      this.metrics.systemHealth.status = 'warning';
    } else {
      this.metrics.systemHealth.status = 'healthy';
    }
    
    this.metrics.systemHealth.errorRate = activeAlerts.length;
    
    if (activeAlerts.length > 0) {
      this.metrics.systemHealth.lastError = activeAlerts[activeAlerts.length - 1].message;
    }
  }

  /**
   * Check individual decision performance
   */
  private checkDecisionPerformance(decisionTimeMs: number): void {
    if (decisionTimeMs > 5000) {
      this.createAlert(
        'performance',
        'medium',
        'Slow decision processing detected',
        { decisionTimeMs }
      );
    }
  }

  /**
   * Create a new alert
   */
  private createAlert(
    type: PerformanceAlert['type'],
    severity: PerformanceAlert['severity'],
    message: string,
    details: Record<string, any>
  ): void {
    // Check if similar alert already exists and is active
    const existingAlert = this.alerts.find(
      a => !a.resolved && a.type === type && a.message === message
    );
    
    if (existingAlert) {
      // Update existing alert details
      existingAlert.details = { ...existingAlert.details, ...details };
      existingAlert.timestamp = new Date();
      return;
    }
    
    const alert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message,
      details,
      timestamp: new Date(),
      resolved: false
    };
    
    this.alerts.push(alert);
    
    // Keep only recent alerts
    if (this.alerts.length > this.maxAlertsHistory) {
      this.alerts = this.alerts.slice(-this.maxAlertsHistory);
    }
    
    logger.warn('Strategy monitoring alert created', {
      alertId: alert.id,
      type,
      severity,
      message,
      details
    });
  }

  /**
   * Group decisions by regime
   */
  private groupByRegime(decisions: StrategyDecision[]): Record<MarketRegime, StrategyDecision[]> {
    return decisions.reduce((groups, decision) => {
      const regime = decision.regime;
      if (!groups[regime]) {
        groups[regime] = [];
      }
      groups[regime].push(decision);
      return groups;
    }, {} as Record<MarketRegime, StrategyDecision[]>);
  }

  /**
   * Analyze confidence distribution
   */
  private analyzeConfidenceDistribution(decisions: StrategyDecision[]) {
    const ranges = [
      { min: 0, max: 0.2, label: '0.0-0.2' },
      { min: 0.2, max: 0.4, label: '0.2-0.4' },
      { min: 0.4, max: 0.6, label: '0.4-0.6' },
      { min: 0.6, max: 0.8, label: '0.6-0.8' },
      { min: 0.8, max: 1.0, label: '0.8-1.0' }
    ];
    
    const distribution = ranges.map(range => {
      const count = decisions.filter(d => 
        d.confidenceScore >= range.min && d.confidenceScore < range.max
      ).length;
      return {
        range: range.label,
        count,
        percentage: (count / decisions.length) * 100
      };
    });
    
    const lowConfidenceCount = decisions.filter(d => d.confidenceScore < 0.6).length;
    const lowConfidenceRate = (lowConfidenceCount / decisions.length) * 100;
    
    const avgConfidence = decisions.reduce((sum, d) => sum + d.confidenceScore, 0) / decisions.length;
    const qualityScore = Math.max(0, Math.min(1, (avgConfidence - 0.5) * 2));
    
    return {
      distribution,
      lowConfidenceRate,
      qualityScore
    };
  }

  /**
   * Analyze time patterns
   */
  private analyzeTimePatterns(decisions: StrategyDecision[]) {
    // Group by hour
    const hourlyGroups = decisions.reduce((groups, decision) => {
      const hour = decision.candleTimestamp.getUTCHours();
      if (!groups[hour]) {
        groups[hour] = [];
      }
      groups[hour].push(decision);
      return groups;
    }, {} as Record<number, StrategyDecision[]>);
    
    const hourlyDistribution = Object.entries(hourlyGroups).map(([hour, hourDecisions]) => ({
      hour: parseInt(hour),
      decisions: hourDecisions.length,
      avgConfidence: hourDecisions.reduce((sum, d) => sum + d.confidenceScore, 0) / hourDecisions.length
    }));
    
    // Find peak and low performance hours
    const sortedByConfidence = [...hourlyDistribution].sort((a, b) => b.avgConfidence - a.avgConfidence);
    const peakPerformanceHours = sortedByConfidence.slice(0, 3).map(h => h.hour);
    const lowPerformanceHours = sortedByConfidence.slice(-3).map(h => h.hour);
    
    return {
      hourlyDistribution,
      peakPerformanceHours,
      lowPerformanceHours
    };
  }

  /**
   * Calculate confidence distribution for metrics
   */
  private calculateConfidenceDistribution(decisions: StrategyDecision[]): Record<string, number> {
    const ranges = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
    const distribution: Record<string, number> = {};
    
    ranges.forEach(range => {
      const [min, max] = range.split('-').map(Number);
      distribution[range] = decisions.filter(d => 
        d.confidenceScore >= min && d.confidenceScore < max
      ).length;
    });
    
    return distribution;
  }

  /**
   * Determine quality trend
   */
  private async determineQualityTrend(
    startDate: Date,
    endDate: Date,
    currentAvgConfidence: number
  ): Promise<'improving' | 'stable' | 'declining'> {
    try {
      // Get previous period for comparison
      const periodDuration = endDate.getTime() - startDate.getTime();
      const previousStart = new Date(startDate.getTime() - periodDuration);
      const previousEnd = startDate;
      
      const previousDecisions = await this.decisionRepository.getDecisionsByDateRange(
        previousStart,
        previousEnd
      );
      
      if (previousDecisions.length === 0) {
        return 'stable';
      }
      
      const previousAvgConfidence = previousDecisions.reduce((sum, d) => sum + d.confidenceScore, 0) / previousDecisions.length;
      const confidenceDiff = currentAvgConfidence - previousAvgConfidence;
      
      if (confidenceDiff > 0.05) {
        return 'improving';
      } else if (confidenceDiff < -0.05) {
        return 'declining';
      } else {
        return 'stable';
      }
    } catch (error) {
      logger.error('Failed to determine quality trend', { error });
      return 'stable';
    }
  }

  /**
   * Create empty quality analysis
   */
  private createEmptyQualityAnalysis(startDate: Date, endDate: Date): DecisionQualityAnalysis {
    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalDecisions: 0,
        signalRate: 0,
        avgConfidence: 0,
        qualityTrend: 'stable'
      },
      regimeAnalysis: [],
      confidenceAnalysis: {
        distribution: [],
        lowConfidenceRate: 0,
        qualityScore: 0
      },
      timeAnalysis: {
        hourlyDistribution: [],
        peakPerformanceHours: [],
        lowPerformanceHours: []
      }
    };
  }
}