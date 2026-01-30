import type { Candle } from '../types/database.js';
import type { 
  IndicatorData, 
  StrategyDecision, 
  StrategyConfig,
  StrategyRunRecord 
} from './strategy.types.js';

import { StrategyEngineImpl } from './strategy-engine.js';
import { StrategyConfigManager } from './strategy-config-manager.js';
import { StrategyRunRepository } from '../repositories/strategy-run.repository.js';
import { StrategyErrorHandler } from './strategy-error-handler.js';

import { getLatestEMA } from '../indicators/ema.indicator.js';
import { getLatestATR } from '../indicators/atr.indicator.js';
import { getRecentSwings } from '../indicators/swing.indicator.js';

export interface RunOptions {
  pair: string;
  timeframe: string;
  startTime?: Date;
  endTime?: Date;
  batchSize?: number;
  maxCandles?: number;
  dryRun?: boolean;
}

export interface RunProgress {
  runId: string;
  totalCandles: number;
  processedCandles: number;
  generatedSignals: number;
  errors: number;
  startTime: Date;
  estimatedCompletion?: Date;
  currentCandle?: Date;
}

export interface RunResult {
  runId: string;
  success: boolean;
  totalCandles: number;
  processedCandles: number;
  generatedSignals: number;
  errors: string[];
  duration: number; // milliseconds
  performance: {
    candlesPerSecond: number;
    signalsPerCandle: number;
    errorRate: number;
  };
}

export type ProgressCallback = (progress: RunProgress) => void;

/**
 * Service for running strategy engine on historical and real-time data
 */
export class StrategyRunnerService {
  private strategyEngine: StrategyEngineImpl;
  private configManager: StrategyConfigManager;
  private runRepository: StrategyRunRepository;
  private errorHandler: StrategyErrorHandler;
  
  private activeRuns: Map<string, {
    runRecord: StrategyRunRecord;
    progress: RunProgress;
    abortController: AbortController;
  }> = new Map();

  constructor(
    configManager?: StrategyConfigManager,
    strategyEngine?: StrategyEngineImpl
  ) {
    this.configManager = configManager || new StrategyConfigManager();
    this.strategyEngine = strategyEngine || new StrategyEngineImpl();
    this.runRepository = new StrategyRunRepository();
    this.errorHandler = new StrategyErrorHandler();
  }

  /**
   * Initialize the runner service
   */
  async initialize(): Promise<void> {
    await this.configManager.initialize();
    
    // Update strategy engine with current config
    const config = this.configManager.getConfig();
    this.strategyEngine.updateConfig(config);

    // Listen for config changes
    this.configManager.addChangeListener((event) => {
      this.strategyEngine.updateConfig(event.newConfig);
    });
  }

  /**
   * Run strategy on historical data
   */
  async runHistorical(
    candles: Candle[],
    options: RunOptions,
    progressCallback?: ProgressCallback
  ): Promise<RunResult> {
    const runId = await this.startRun(options, 'HISTORICAL');
    
    try {
      // Validate input
      if (!candles || candles.length === 0) {
        throw new Error('No candles provided for historical run');
      }

      // Sort candles by timestamp
      const sortedCandles = [...candles].sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      );

      // Limit candles if specified
      const candlesToProcess = options.maxCandles 
        ? sortedCandles.slice(0, options.maxCandles)
        : sortedCandles;

      const batchSize = options.batchSize || 100;
      const totalCandles = candlesToProcess.length;
      let processedCandles = 0;
      let generatedSignals = 0;
      const errors: string[] = [];

      // Initialize progress
      const progress: RunProgress = {
        runId,
        totalCandles,
        processedCandles: 0,
        generatedSignals: 0,
        errors: 0,
        startTime: new Date()
      };

      this.updateActiveRun(runId, { progress });

      // Process candles in batches
      for (let i = 0; i < candlesToProcess.length; i += batchSize) {
        // Check for abort signal
        const activeRun = this.activeRuns.get(runId);
        if (activeRun?.abortController.signal.aborted) {
          throw new Error('Run was aborted');
        }

        const batch = candlesToProcess.slice(i, Math.min(i + batchSize, candlesToProcess.length));
        
        for (const candle of batch) {
          try {
            // Get indicators for this candle
            const indicators = await this.getIndicatorsForCandle(candle, sortedCandles, i + batch.indexOf(candle));
            
            if (!options.dryRun) {
              // Process candle through strategy engine
              const decision = await this.strategyEngine.processCandle(candle, indicators);
              
              if (decision.decision !== 'NO_TRADE') {
                generatedSignals++;
              }
            }

            processedCandles++;
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Candle ${candle.timestamp.toISOString()}: ${errorMessage}`);
            
            this.errorHandler.logError(
              error as Error,
              this.errorHandler.createContext('HISTORICAL_RUN', candle.id, candle.timestamp),
              'MEDIUM'
            );
          }
        }

        // Update progress
        progress.processedCandles = processedCandles;
        progress.generatedSignals = generatedSignals;
        progress.errors = errors.length;
        progress.currentCandle = batch[batch.length - 1].timestamp;
        
        // Estimate completion time
        const elapsed = Date.now() - progress.startTime.getTime();
        const rate = processedCandles / elapsed;
        const remaining = totalCandles - processedCandles;
        progress.estimatedCompletion = new Date(Date.now() + (remaining / rate));

        this.updateActiveRun(runId, { progress });

        // Update database
        await this.runRepository.updateProgress(runId, processedCandles, generatedSignals);

        // Call progress callback
        if (progressCallback) {
          progressCallback({ ...progress });
        }

        // Small delay to prevent overwhelming the system
        await this.sleep(10);
      }

      // Complete the run
      const duration = Date.now() - progress.startTime.getTime();
      await this.completeRun(runId, processedCandles, generatedSignals);

      return {
        runId,
        success: true,
        totalCandles,
        processedCandles,
        generatedSignals,
        errors,
        duration,
        performance: {
          candlesPerSecond: processedCandles / (duration / 1000),
          signalsPerCandle: processedCandles > 0 ? generatedSignals / processedCandles : 0,
          errorRate: processedCandles > 0 ? errors.length / processedCandles : 0
        }
      };

    } catch (error) {
      await this.failRun(runId, error instanceof Error ? error.message : 'Unknown error');
      
      const duration = Date.now() - (this.activeRuns.get(runId)?.progress.startTime.getTime() || Date.now());
      
      return {
        runId,
        success: false,
        totalCandles: candles.length,
        processedCandles: this.activeRuns.get(runId)?.progress.processedCandles || 0,
        generatedSignals: this.activeRuns.get(runId)?.progress.generatedSignals || 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        duration,
        performance: {
          candlesPerSecond: 0,
          signalsPerCandle: 0,
          errorRate: 1
        }
      };
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Run strategy incrementally on new candles
   */
  async runIncremental(
    candle: Candle,
    options: RunOptions
  ): Promise<StrategyDecision> {
    const runId = await this.startRun(options, 'INCREMENTAL');
    
    try {
      // Get indicators for this candle
      const indicators = await this.getIndicatorsForCandle(candle);
      
      // Process candle through strategy engine
      const decision = await this.strategyEngine.processCandle(candle, indicators);
      
      // Update run statistics
      const signalsGenerated = decision.decision !== 'NO_TRADE' ? 1 : 0;
      await this.completeRun(runId, 1, signalsGenerated);
      
      return decision;
      
    } catch (error) {
      await this.failRun(runId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Get indicators for a specific candle
   */
  private async getIndicatorsForCandle(
    candle: Candle, 
    allCandles?: Candle[], 
    currentIndex?: number
  ): Promise<IndicatorData> {
    // In a real implementation, this would fetch from indicator repositories
    // For now, we'll create mock data based on candle prices
    
    const basePrice = candle.close;
    const volatility = (candle.high - candle.low) / candle.close;
    
    return {
      ema20: basePrice * (1 + Math.random() * 0.001 - 0.0005), // Small random variation
      ema50: basePrice * (1 + Math.random() * 0.002 - 0.001),
      ema200: basePrice * (1 + Math.random() * 0.005 - 0.0025),
      atr: volatility * basePrice,
      swingHighs: this.generateMockSwings(candle, 'high'),
      swingLows: this.generateMockSwings(candle, 'low')
    };
  }

  /**
   * Generate mock swing points for testing
   */
  private generateMockSwings(candle: Candle, type: 'high' | 'low'): any[] {
    const swings = [];
    const basePrice = type === 'high' ? candle.high : candle.low;
    
    for (let i = 0; i < 5; i++) {
      const variation = type === 'high' ? 1 + (i * 0.001) : 1 - (i * 0.001);
      swings.push({
        pair: candle.pair,
        timeframe: candle.timeframe,
        timestamp: new Date(candle.timestamp.getTime() - (i + 1) * 15 * 60 * 1000),
        type,
        price: basePrice * variation,
        lookback_periods: 5
      });
    }
    
    return swings;
  }

  /**
   * Start a new strategy run
   */
  private async startRun(options: RunOptions, runType: 'HISTORICAL' | 'INCREMENTAL'): Promise<string> {
    const runRecord = await this.runRepository.create(
      options.pair,
      options.timeframe,
      runType
    );

    const abortController = new AbortController();
    
    this.activeRuns.set(runRecord.id, {
      runRecord,
      progress: {
        runId: runRecord.id,
        totalCandles: 0,
        processedCandles: 0,
        generatedSignals: 0,
        errors: 0,
        startTime: runRecord.startedAt
      },
      abortController
    });

    return runRecord.id;
  }

  /**
   * Update active run data
   */
  private updateActiveRun(runId: string, updates: Partial<{ progress: RunProgress }>): void {
    const activeRun = this.activeRuns.get(runId);
    if (activeRun && updates.progress) {
      activeRun.progress = { ...activeRun.progress, ...updates.progress };
    }
  }

  /**
   * Complete a strategy run
   */
  private async completeRun(runId: string, candlesProcessed: number, tradesGenerated: number): Promise<void> {
    await this.runRepository.complete(runId, candlesProcessed, tradesGenerated);
  }

  /**
   * Mark a strategy run as failed
   */
  private async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.runRepository.markAsFailed(runId, errorMessage);
  }

  /**
   * Abort an active run
   */
  async abortRun(runId: string): Promise<void> {
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      activeRun.abortController.abort();
      await this.failRun(runId, 'Run aborted by user');
    }
  }

  /**
   * Get active runs
   */
  getActiveRuns(): RunProgress[] {
    return Array.from(this.activeRuns.values()).map(run => ({ ...run.progress }));
  }

  /**
   * Get run progress
   */
  getRunProgress(runId: string): RunProgress | null {
    const activeRun = this.activeRuns.get(runId);
    return activeRun ? { ...activeRun.progress } : null;
  }

  /**
   * Get run statistics
   */
  async getRunStatistics(
    pair: string,
    timeframe: string,
    days: number = 30
  ): Promise<{
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    averageCandlesPerRun: number;
    averageSignalsPerRun: number;
    averageDuration: number;
    recentPerformance: any;
  }> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);
    
    const stats = await this.runRepository.getRunStats(startTime, endTime, pair, timeframe);
    const performance = await this.runRepository.getPerformanceMetrics(pair, timeframe, 10);
    
    return {
      totalRuns: stats.totalRuns,
      completedRuns: stats.completedRuns,
      failedRuns: stats.totalRuns - stats.completedRuns,
      averageCandlesPerRun: stats.averageCandlesPerRun,
      averageSignalsPerRun: stats.averageTradesPerRun,
      averageDuration: stats.averageRunDuration,
      recentPerformance: performance
    };
  }

  /**
   * Cleanup old runs
   */
  async cleanupOldRuns(days: number = 90): Promise<number> {
    return await this.runRepository.deleteOlderThan(days);
  }

  /**
   * Validate run options
   */
  private validateRunOptions(options: RunOptions): string[] {
    const errors: string[] = [];

    if (!options.pair) {
      errors.push('Pair is required');
    }

    if (!options.timeframe) {
      errors.push('Timeframe is required');
    }

    if (options.startTime && options.endTime && options.startTime >= options.endTime) {
      errors.push('Start time must be before end time');
    }

    if (options.batchSize && options.batchSize <= 0) {
      errors.push('Batch size must be positive');
    }

    if (options.maxCandles && options.maxCandles <= 0) {
      errors.push('Max candles must be positive');
    }

    return errors;
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get engine status
   */
  getEngineStatus() {
    return this.strategyEngine.getEngineStatus();
  }

  /**
   * Update strategy configuration
   */
  async updateConfig(config: Partial<StrategyConfig>): Promise<void> {
    await this.configManager.updateConfig(config);
  }

  /**
   * Get current configuration
   */
  getConfig(): StrategyConfig {
    return this.configManager.getConfig();
  }

  /**
   * Shutdown the runner service
   */
  async shutdown(): Promise<void> {
    // Abort all active runs
    const activeRunIds = Array.from(this.activeRuns.keys());
    await Promise.all(activeRunIds.map(runId => this.abortRun(runId)));
    
    // Stop strategy engine
    this.strategyEngine.stop();
    
    // Cleanup config manager
    this.configManager.destroy();
  }
}