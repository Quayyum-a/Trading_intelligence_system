import { Router } from 'express';
import { logger } from '../config/logger.js';
import { StrategyMetricsDashboard } from '../strategy/strategy-metrics-dashboard.js';
import { StrategyMonitoringService } from '../strategy/strategy-monitoring.service.js';
import { StrategyHealthChecker } from '../strategy/strategy-health-checker.js';
import { StrategyEngineImpl } from '../strategy/strategy-engine.js';
import { DEFAULT_STRATEGY_CONFIG } from '../strategy/strategy.config.js';

/**
 * Strategy Monitoring API Routes
 * 
 * Provides REST endpoints for strategy monitoring and metrics
 * Requirements: 6.1, 6.2, 6.3, 8.1
 */

const router = Router();

// Initialize services
const dashboard = new StrategyMetricsDashboard();
const monitoringService = new StrategyMonitoringService();
const healthChecker = new StrategyHealthChecker(monitoringService);

// Mock strategy engine for demonstration (in real implementation, this would be injected)
const mockEngine = new StrategyEngineImpl();

/**
 * GET /api/strategy/monitoring/dashboard
 * Get comprehensive dashboard metrics
 */
router.get('/dashboard', async (req, res) => {
  try {
    logger.info('Dashboard metrics requested');
    
    const engineStatus = mockEngine.getEngineStatus();
    const config = mockEngine.getConfig();
    
    const dashboardMetrics = await dashboard.getDashboardMetrics(engineStatus, config);
    
    res.json({
      success: true,
      data: dashboardMetrics,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get dashboard metrics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/status
 * Get real-time system status
 */
router.get('/status', async (req, res) => {
  try {
    logger.info('System status requested');
    
    const engineStatus = mockEngine.getEngineStatus();
    const statusSummary = await dashboard.getStatusSummary(engineStatus);
    
    res.json({
      success: true,
      data: statusSummary,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get system status', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve system status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/metrics
 * Get raw strategy metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    logger.info('Raw metrics requested');
    
    const metrics = await monitoringService.getMetrics();
    
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get metrics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/health
 * Get comprehensive health check report
 */
router.get('/health', async (req, res) => {
  try {
    logger.info('Health check requested');
    
    const engineStatus = mockEngine.getEngineStatus();
    const config = mockEngine.getConfig();
    
    const healthReport = await healthChecker.runHealthCheck(engineStatus, config);
    
    res.json({
      success: true,
      data: healthReport,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to run health check', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to run health check',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/alerts
 * Get active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    logger.info('Alerts requested');
    
    const activeOnly = req.query.active === 'true';
    const alerts = activeOnly 
      ? monitoringService.getActiveAlerts()
      : monitoringService.getAllAlerts();
    
    res.json({
      success: true,
      data: {
        alerts,
        summary: {
          total: alerts.length,
          active: monitoringService.getActiveAlerts().length,
          critical: alerts.filter(a => a.severity === 'critical').length,
          high: alerts.filter(a => a.severity === 'high').length,
          medium: alerts.filter(a => a.severity === 'medium').length,
          low: alerts.filter(a => a.severity === 'low').length
        }
      },
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get alerts', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alerts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/strategy/monitoring/alerts/:alertId/resolve
 * Resolve a specific alert
 */
router.post('/alerts/:alertId/resolve', async (req, res) => {
  try {
    const { alertId } = req.params;
    logger.info('Alert resolution requested', { alertId });
    
    const resolved = monitoringService.resolveAlert(alertId);
    
    if (resolved) {
      res.json({
        success: true,
        message: 'Alert resolved successfully',
        alertId
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Alert not found',
        alertId
      });
    }

  } catch (error) {
    logger.error('Failed to resolve alert', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to resolve alert',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/strategy/monitoring/alerts/resolved
 * Clear all resolved alerts
 */
router.delete('/alerts/resolved', async (req, res) => {
  try {
    logger.info('Clear resolved alerts requested');
    
    const clearedCount = monitoringService.clearResolvedAlerts();
    
    res.json({
      success: true,
      message: `Cleared ${clearedCount} resolved alerts`,
      clearedCount
    });

  } catch (error) {
    logger.error('Failed to clear resolved alerts', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear resolved alerts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/analytics
 * Get decision quality analytics for a time period
 */
router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate, hours = '24' } = req.query;
    
    let start: Date;
    let end: Date = new Date();
    
    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    } else {
      // Default to last N hours
      const hoursBack = parseInt(hours as string, 10);
      start = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    }
    
    logger.info('Analytics requested', { startDate: start, endDate: end });
    
    const analyticsReport = await dashboard.getAnalyticsReport(start, end);
    
    res.json({
      success: true,
      data: analyticsReport,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get analytics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/performance
 * Get performance statistics
 */
router.get('/performance', async (req, res) => {
  try {
    logger.info('Performance statistics requested');
    
    const metrics = await monitoringService.getMetrics();
    
    const performanceData = {
      current: {
        avgDecisionTimeMs: metrics.performance.avgDecisionTimeMs,
        memoryUsageMB: metrics.performance.memoryUsageMB,
        decisionsPerMinute: metrics.performance.decisionsPerMinute
      },
      system: {
        uptime: metrics.systemHealth.uptime,
        status: metrics.systemHealth.status,
        errorRate: metrics.systemHealth.errorRate
      },
      quality: {
        avgConfidenceScore: metrics.decisionQuality.avgConfidenceScore,
        totalDecisions: metrics.decisionQuality.totalDecisions,
        signalRate: metrics.decisionQuality.totalDecisions > 0 
          ? (metrics.decisionQuality.tradeSignals / metrics.decisionQuality.totalDecisions) * 100
          : 0
      }
    };
    
    res.json({
      success: true,
      data: performanceData,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get performance statistics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/strategy/monitoring/health/check
 * Trigger manual health check
 */
router.post('/health/check', async (req, res) => {
  try {
    logger.info('Manual health check triggered');
    
    const engineStatus = mockEngine.getEngineStatus();
    const config = mockEngine.getConfig();
    
    // Run health monitoring (which may generate alerts)
    await monitoringService.monitorHealth(engineStatus, config);
    
    // Get updated health report
    const healthReport = await healthChecker.runHealthCheck(engineStatus, config);
    
    res.json({
      success: true,
      data: healthReport,
      message: 'Health check completed',
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to run manual health check', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to run health check',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/strategy/monitoring/config
 * Get current monitoring configuration
 */
router.get('/config', async (req, res) => {
  try {
    logger.info('Monitoring configuration requested');
    
    const config = mockEngine.getConfig();
    
    const monitoringConfig = {
      strategy: {
        pair: config.pair,
        timeframe: config.timeframe,
        tradingWindow: config.tradingWindow,
        confidence: config.confidence
      },
      monitoring: {
        metricsUpdateInterval: '1 minute',
        alertRetention: '100 alerts',
        healthCheckComponents: [
          'engine_status',
          'performance_metrics',
          'decision_quality',
          'system_resources',
          'audit_compliance',
          'alert_status',
          'database_connectivity'
        ]
      },
      thresholds: {
        performance: {
          maxDecisionTimeMs: 1000,
          maxMemoryUsageMB: 512,
          minDecisionsPerMinute: 0.1
        },
        quality: {
          minConfidenceScore: config.confidence.minThreshold,
          maxSignalRate: 50,
          minSignalRate: 2
        },
        system: {
          maxErrorCount: 10,
          maxActiveAlerts: 5
        }
      }
    };
    
    res.json({
      success: true,
      data: monitoringConfig,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Failed to get monitoring configuration', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve monitoring configuration',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;