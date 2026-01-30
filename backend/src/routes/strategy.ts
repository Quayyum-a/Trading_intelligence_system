import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Candle } from '../types/database.js';
import type { IndicatorData, StrategyConfig } from '../strategy/strategy.types.js';

import { StrategyRunnerService } from '../strategy/strategy-runner.service.js';
import { StrategyDecisionRepository } from '../repositories/strategy-decision.repository.js';
import { TradeSignalRepository } from '../repositories/trade-signal.repository.js';
import { StrategyAuditRepository } from '../repositories/strategy-audit.repository.js';
import { StrategyRunRepository } from '../repositories/strategy-run.repository.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

// Initialize services
const strategyRunner = new StrategyRunnerService();
const decisionRepository = new StrategyDecisionRepository();
const signalRepository = new TradeSignalRepository();
const auditRepository = new StrategyAuditRepository();
const runRepository = new StrategyRunRepository();

// WebSocket clients for real-time streaming
const wsClients = new Set<any>();

// Initialize runner service
strategyRunner.initialize().catch(console.error);

// Types for request/reply
interface ProcessCandleRequest {
  Body: {
    candle: Candle;
    indicators: IndicatorData;
  };
}

interface HistoricalRunRequest {
  Body: {
    candles: Candle[];
    options?: {
      pair: string;
      timeframe: string;
    };
  };
}

interface ConfigUpdateRequest {
  Body: {
    config: StrategyConfig;
  };
}

interface CleanupRequest {
  Body: {
    days?: number;
  };
}

interface DecisionQueryParams {
  pair?: string;
  timeframe?: string;
  decision?: string;
  startTime?: string;
  endTime?: string;
  limit?: string;
  minConfidence?: string;
}

interface SignalQueryParams {
  direction?: string;
  startTime?: string;
  endTime?: string;
  minRR?: string;
  limit?: string;
}

interface RunQueryParams {
  pair?: string;
  timeframe?: string;
  runType?: string;
  limit?: string;
}

interface StatisticsQueryParams {
  pair?: string;
  timeframe?: string;
  days?: string;
  startTime?: string;
  endTime?: string;
}

export async function registerStrategyRoutes(app: FastifyInstance): Promise<void> {
  // Register WebSocket support
  await app.register(import('@fastify/websocket'));

  // WebSocket endpoint for real-time decision streaming
  app.register(async function (fastify) {
    fastify.get('/api/strategy/stream', { websocket: true }, (connection, req) => {
      logger.info('New WebSocket client connected for strategy streaming');
      wsClients.add(connection);

      connection.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          logger.info('WebSocket message received', { data });
          
          // Handle subscription requests
          if (data.type === 'subscribe') {
            connection.send(JSON.stringify({
              type: 'subscribed',
              message: 'Successfully subscribed to strategy decisions',
              timestamp: new Date().toISOString()
            }));
          }
        } catch (error) {
          logger.error('Error processing WebSocket message', { error });
          connection.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            timestamp: new Date().toISOString()
          }));
        }
      });

      connection.on('close', () => {
        logger.info('WebSocket client disconnected');
        wsClients.delete(connection);
      });

      connection.on('error', (error) => {
        logger.error('WebSocket error', { error });
        wsClients.delete(connection);
      });

      // Send initial connection confirmation
      connection.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to strategy decision stream',
        timestamp: new Date().toISOString()
      }));
    });
  });

  // Helper function to broadcast to WebSocket clients
  const broadcastToClients = (data: any) => {
    const message = JSON.stringify({
      type: 'decision',
      data,
      timestamp: new Date().toISOString()
    });

    wsClients.forEach(client => {
      try {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      } catch (error) {
        logger.error('Error broadcasting to WebSocket client', { error });
        wsClients.delete(client);
      }
    });
  };

  /**
   * GET /api/strategy/status
   * Get strategy engine status
   */
  app.get('/api/strategy/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engineStatus = strategyRunner.getEngineStatus();
      const activeRuns = strategyRunner.getActiveRuns();
      
      return reply.send({
        success: true,
        data: {
          engine: engineStatus,
          activeRuns: activeRuns.length,
          runs: activeRuns
        }
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/strategy/process
   * Process a single candle through strategy engine
   */
  app.post<ProcessCandleRequest>('/api/strategy/process', async (request, reply) => {
    try {
      const { candle, indicators } = request.body;
      
      if (!candle || !indicators) {
        return reply.code(400).send({
          success: false,
          error: 'Candle and indicators are required'
        });
      }

      // Convert timestamp string to Date if needed
      if (typeof candle.timestamp === 'string') {
        candle.timestamp = new Date(candle.timestamp);
      }

      const decision = await strategyRunner.runIncremental(candle as Candle, {
        pair: candle.pair,
        timeframe: candle.timeframe
      });

      // Broadcast decision to WebSocket clients
      broadcastToClients(decision);

      return reply.send({
        success: true,
        data: decision
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/strategy/run/historical
   * Run strategy on historical data
   */
  app.post<HistoricalRunRequest>('/api/strategy/run/historical', async (request, reply) => {
    try {
      const { candles, options } = request.body;
      
      if (!candles || !Array.isArray(candles)) {
        return reply.code(400).send({
          success: false,
          error: 'Candles array is required'
        });
      }

      // Convert timestamp strings to Dates
      const processedCandles = candles.map((candle: any) => ({
        ...candle,
        timestamp: new Date(candle.timestamp)
      }));

      const result = await strategyRunner.runHistorical(
        processedCandles,
        options || { pair: 'XAU/USD', timeframe: '15M' }
      );

      return reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/decisions
   * Get strategy decisions with filtering
   */
  app.get<{ Querystring: DecisionQueryParams }>('/api/strategy/decisions', async (request, reply) => {
    try {
      const {
        pair = 'XAU/USD',
        timeframe = '15M',
        decision,
        startTime,
        endTime,
        limit = '50',
        minConfidence
      } = request.query;

      let decisions;

      if (startTime && endTime) {
        decisions = await decisionRepository.getByTimeRange(
          pair,
          timeframe,
          new Date(startTime),
          new Date(endTime)
        );
      } else if (decision) {
        decisions = await decisionRepository.getByDecisionType(
          pair,
          timeframe,
          decision as any,
          parseInt(limit)
        );
      } else if (minConfidence) {
        decisions = await decisionRepository.getHighConfidenceDecisions(
          pair,
          timeframe,
          parseFloat(minConfidence),
          parseInt(limit)
        );
      } else {
        decisions = await decisionRepository.getRecent(
          pair,
          timeframe,
          parseInt(limit)
        );
      }

      return reply.send({
        success: true,
        data: decisions
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/decisions/:id
   * Get specific strategy decision with audit trail
   */
  app.get<{ Params: { id: string } }>('/api/strategy/decisions/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      
      const decision = await decisionRepository.getById(id);
      if (!decision) {
        return reply.code(404).send({
          success: false,
          error: 'Decision not found'
        });
      }

      const auditTrail = await auditRepository.getAuditTrail(id);
      const signal = decision.decision !== 'NO_TRADE' 
        ? await signalRepository.getByStrategyDecisionId(id)
        : null;

      return reply.send({
        success: true,
        data: {
          decision,
          auditTrail,
          signal
        }
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/signals
   * Get trade signals with filtering
   */
  app.get<{ Querystring: SignalQueryParams }>('/api/strategy/signals', async (request, reply) => {
    try {
      const {
        direction,
        startTime,
        endTime,
        minRR,
        limit = '50'
      } = request.query;

      let signals;

      if (startTime && endTime) {
        signals = await signalRepository.getByTimeRange(
          new Date(startTime),
          new Date(endTime),
          direction as any
        );
      } else if (minRR) {
        signals = await signalRepository.getHighRRSignals(
          parseFloat(minRR),
          parseInt(limit)
        );
      } else {
        signals = await signalRepository.getRecent(
          parseInt(limit),
          direction as any
        );
      }

      return reply.send({
        success: true,
        data: signals
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/runs
   * Get strategy runs with filtering
   */
  app.get<{ Querystring: RunQueryParams }>('/api/strategy/runs', async (request, reply) => {
    try {
      const {
        pair,
        timeframe,
        runType,
        limit = '50'
      } = request.query;

      let runs;

      if (runType) {
        runs = await runRepository.getByType(
          runType as any,
          parseInt(limit)
        );
      } else {
        runs = await runRepository.getRecent(
          pair,
          timeframe,
          parseInt(limit)
        );
      }

      return reply.send({
        success: true,
        data: runs
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/runs/:id
   * Get specific strategy run details
   */
  app.get<{ Params: { id: string } }>('/api/strategy/runs/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      
      const run = await runRepository.getById(id);
      if (!run) {
        return reply.code(404).send({
          success: false,
          error: 'Run not found'
        });
      }

      // Get progress if run is active
      const progress = strategyRunner.getRunProgress(id);

      return reply.send({
        success: true,
        data: {
          run,
          progress
        }
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/strategy/runs/:id/abort
   * Abort an active strategy run
   */
  app.post<{ Params: { id: string } }>('/api/strategy/runs/:id/abort', async (request, reply) => {
    try {
      const { id } = request.params;
      
      await strategyRunner.abortRun(id);

      return reply.send({
        success: true,
        message: 'Run aborted successfully'
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/statistics
   * Get strategy performance statistics
   */
  app.get<{ Querystring: StatisticsQueryParams }>('/api/strategy/statistics', async (request, reply) => {
    try {
      const {
        pair = 'XAU/USD',
        timeframe = '15M',
        days = '30',
        startTime,
        endTime
      } = request.query;

      const endDate = endTime ? new Date(endTime) : new Date();
      const startDate = startTime 
        ? new Date(startTime)
        : new Date(endDate.getTime() - parseInt(days) * 24 * 60 * 60 * 1000);

      // Get decision statistics
      const decisionStats = await decisionRepository.getDecisionStats(
        pair,
        timeframe,
        startDate,
        endDate
      );

      // Get signal statistics
      const signalStats = await signalRepository.getSignalStats(startDate, endDate);

      // Get run statistics
      const runStats = await strategyRunner.getRunStatistics(
        pair,
        timeframe,
        parseInt(days)
      );

      // Get audit statistics
      const auditStats = await auditRepository.getAuditStats(startDate, endDate);

      return reply.send({
        success: true,
        data: {
          period: {
            startDate,
            endDate,
            days: Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
          },
          decisions: decisionStats,
          signals: signalStats,
          runs: runStats,
          audit: auditStats
        }
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/config
   * Get current strategy configuration
   */
  app.get('/api/strategy/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = strategyRunner.getConfig();
      
      return reply.send({
        success: true,
        data: config
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/strategy/config
   * Update strategy configuration
   */
  app.put<ConfigUpdateRequest>('/api/strategy/config', async (request, reply) => {
    try {
      const { config } = request.body;
      
      if (!config) {
        return reply.code(400).send({
          success: false,
          error: 'Configuration is required'
        });
      }

      await strategyRunner.updateConfig(config);
      const updatedConfig = strategyRunner.getConfig();

      return reply.send({
        success: true,
        data: updatedConfig,
        message: 'Configuration updated successfully'
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/audit/:decisionId
   * Get audit trail for a specific decision
   */
  app.get<{ Params: { decisionId: string } }>('/api/strategy/audit/:decisionId', async (request, reply) => {
    try {
      const { decisionId } = request.params;
      
      const auditTrail = await auditRepository.getAuditTrail(decisionId);
      
      return reply.send({
        success: true,
        data: auditTrail
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/strategy/health
   * Health check endpoint for strategy engine
   */
  app.get('/api/strategy/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const engineStatus = strategyRunner.getEngineStatus();
      const activeRuns = strategyRunner.getActiveRuns();
      
      const health = {
        status: engineStatus.isRunning ? 'healthy' : 'unhealthy',
        engine: {
          running: engineStatus.isRunning,
          totalDecisions: engineStatus.totalDecisions,
          totalSignals: engineStatus.totalSignals,
          errors: engineStatus.errors.length,
          lastProcessed: engineStatus.lastProcessedCandle
        },
        runs: {
          active: activeRuns.length,
          details: activeRuns
        },
        timestamp: new Date().toISOString()
      };

      const statusCode = health.status === 'healthy' ? 200 : 503;
      return reply.code(statusCode).send({
        success: health.status === 'healthy',
        data: health
      });
    } catch (error) {
      return reply.code(503).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'unhealthy'
      });
    }
  });

  /**
   * POST /api/strategy/cleanup
   * Cleanup old strategy data
   */
  app.post<CleanupRequest>('/api/strategy/cleanup', async (request, reply) => {
    try {
      const { days = 90 } = request.body;
      
      const deletedRuns = await strategyRunner.cleanupOldRuns(days);
      const deletedDecisions = await decisionRepository.deleteOlderThan(days);
      const deletedSignals = await signalRepository.deleteOlderThan(days);
      const deletedAuditLogs = await auditRepository.deleteOlderThan(days);

      return reply.send({
        success: true,
        data: {
          deletedRuns,
          deletedDecisions,
          deletedSignals,
          deletedAuditLogs,
          totalDeleted: deletedRuns + deletedDecisions + deletedSignals + deletedAuditLogs
        },
        message: `Cleanup completed for data older than ${days} days`
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}