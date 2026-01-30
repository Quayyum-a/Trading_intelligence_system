import type { Candle } from '../types/database.js';
import type {
  IndicatorData,
  StrategyEngine,
  StrategyDecision,
  EngineStatus,
  DecisionType,
  TradeSignal,
  DecisionReason,
  TimeContext,
  StrategyConfig
} from './strategy.types.js';

import { MarketRegimeDetectionService } from './market-regime.service.js';
import { SetupDetectionServiceImpl } from './setup-detection.service.js';
import { TradeQualificationServiceImpl } from './trade-qualification.service.js';
import { RiskEngineServiceImpl } from './risk-engine.service.js';
import { RREngineServiceImpl } from './rr-engine.service.js';
import { ConfidenceScorerImpl } from './confidence-scorer.service.js';
import { StrategyMonitoringService } from './strategy-monitoring.service.js';

import { StrategyDecisionRepository } from '../repositories/strategy-decision.repository.js';
import { TradeSignalRepository } from '../repositories/trade-signal.repository.js';
import { StrategyAuditRepository } from '../repositories/strategy-audit.repository.js';

import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class StrategyEngineImpl implements StrategyEngine {
  private marketRegimeService: MarketRegimeDetectionService;
  private setupDetectionService: SetupDetectionServiceImpl;
  private tradeQualificationService: TradeQualificationServiceImpl;
  private riskEngineService: RiskEngineServiceImpl;
  private rrEngineService: RREngineServiceImpl;
  private confidenceScorer: ConfidenceScorerImpl;
  private monitoringService: StrategyMonitoringService;

  private decisionRepository: StrategyDecisionRepository;
  private signalRepository: TradeSignalRepository;
  private auditRepository: StrategyAuditRepository;

  private config: StrategyConfig;
  private status: EngineStatus;

  constructor(config?: Partial<StrategyConfig>) {
    // Initialize services
    this.marketRegimeService = new MarketRegimeDetectionService();
    this.setupDetectionService = new SetupDetectionServiceImpl();
    this.tradeQualificationService = new TradeQualificationServiceImpl();
    this.riskEngineService = new RiskEngineServiceImpl();
    this.rrEngineService = new RREngineServiceImpl();
    this.confidenceScorer = new ConfidenceScorerImpl();
    this.monitoringService = new StrategyMonitoringService();

    // Initialize repositories
    this.decisionRepository = new StrategyDecisionRepository();
    this.signalRepository = new TradeSignalRepository();
    this.auditRepository = new StrategyAuditRepository();

    // Initialize configuration
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };

    // Initialize status
    this.status = {
      isRunning: true,
      totalDecisions: 0,
      totalSignals: 0,
      errors: []
    };
  }

  /**
   * Process candle and generate strategy decision
   */
  async processCandle(candle: Candle, indicators: IndicatorData): Promise<StrategyDecision> {
    const decisionId = this.generateDecisionId();
    const startTime = performance.now();
    
    try {
      // Validate trading window first
      if (!this.validateTradingWindow(candle.timestamp)) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          'Outside trading window',
          'TIME'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Stage 1: Market Regime Detection
      const regime = await this.executeRegimeDetection(decisionId, indicators);
      if (regime.regime === 'NO_TRADE') {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          `Market regime: ${regime.reasoning}`,
          'REGIME'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Stage 2: Setup Detection
      const setups = await this.executeSetupDetection(decisionId, regime, indicators, candle);
      if (setups.length === 0) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          'No valid setups detected',
          'SETUP'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Select best setup (highest confidence)
      const bestSetup = setups.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );

      // Stage 3: Trade Qualification
      const qualification = await this.executeTradeQualification(decisionId, bestSetup, indicators, candle);
      if (!qualification.qualified) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          `Trade qualification failed: ${qualification.reasoning}`,
          'QUALIFICATION'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Stage 4: Risk Management
      const risk = await this.executeRiskManagement(decisionId, qualification);
      if (!risk.approved) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          `Risk management failed: ${risk.reasoning}`,
          'RISK'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Stage 5: RR Validation
      const rr = await this.executeRRValidation(decisionId, risk, qualification, candle.close);
      if (!rr.approved) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          `RR validation failed: ${rr.reasoning}`,
          'RR'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Stage 6: Confidence Scoring
      const timeContext = this.createTimeContext(candle.timestamp);
      const confidence = await this.executeConfidenceScoring(
        decisionId, regime, bestSetup, qualification, risk, rr, timeContext
      );
      
      if (!confidence.approved) {
        const decision = await this.createNoTradeDecision(
          decisionId,
          candle,
          `Confidence below threshold: ${confidence.overallScore.toFixed(3)} < ${confidence.threshold}`,
          'CONFIDENCE'
        );
        
        // Record metrics
        const processingTime = performance.now() - startTime;
        this.monitoringService.recordDecisionMetrics(processingTime, decision);
        
        return decision;
      }

      // Create trade signal
      const signal: TradeSignal = {
        direction: bestSetup.direction,
        entryPrice: qualification.entryPrice,
        stopLoss: qualification.stopLoss!,
        takeProfit: qualification.takeProfit!,
        rrRatio: qualification.rrRatio!,
        riskPercent: risk.riskPercent,
        leverage: this.config.risk.leverage,
        positionSize: risk.positionSize,
        marginRequired: rr.marginRequired
      };

      // Create and store decision
      const decision = await this.createTradeDecision(
        decisionId,
        candle,
        bestSetup.direction,
        regime,
        bestSetup,
        confidence.overallScore,
        signal
      );

      // Update status
      this.status.totalDecisions++;
      this.status.totalSignals++;
      this.status.lastProcessedCandle = candle.timestamp;

      // Record metrics
      const processingTime = performance.now() - startTime;
      this.monitoringService.recordDecisionMetrics(processingTime, decision);

      // Run health monitoring periodically
      if (this.status.totalDecisions % 10 === 0) {
        await this.monitoringService.monitorHealth(this.status, this.config);
      }

      return decision;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.status.errors.push(errorMessage);
      
      const decision = await this.createNoTradeDecision(
        decisionId,
        candle,
        `Processing error: ${errorMessage}`,
        'ERROR'
      );

      // Record metrics even for errors
      const processingTime = performance.now() - startTime;
      this.monitoringService.recordDecisionMetrics(processingTime, decision);
      
      return decision;
    }
  }

  /**
   * Validate trading window
   */
  validateTradingWindow(timestamp: Date): boolean {
    const hour = timestamp.getUTCHours();
    const minute = timestamp.getUTCMinutes();
    const timeInMinutes = hour * 60 + minute;

    const [startHour, startMinute] = this.config.tradingWindow.start.split(':').map(Number);
    const [endHour, endMinute] = this.config.tradingWindow.end.split(':').map(Number);
    
    const windowStart = startHour * 60 + startMinute;
    const windowEnd = endHour * 60 + endMinute;

    return timeInMinutes >= windowStart && timeInMinutes <= windowEnd;
  }

  /**
   * Get engine status
   */
  getEngineStatus(): EngineStatus {
    return { ...this.status };
  }

  /**
   * Execute regime detection stage
   */
  private async executeRegimeDetection(decisionId: string, indicators: IndicatorData) {
    try {
      const regime = this.marketRegimeService.detectRegime(indicators);
      
      await this.auditRepository.create(
        decisionId,
        'REGIME',
        'PASSED',
        {
          regime: regime.regime,
          confidence: regime.confidence,
          emaAlignment: regime.emaAlignment,
          swingStructure: regime.swingStructure,
          reasoning: regime.reasoning
        }
      );

      return regime;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'REGIME',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Execute setup detection stage
   */
  private async executeSetupDetection(decisionId: string, regime: any, indicators: IndicatorData, candle: Candle) {
    try {
      const setups = this.setupDetectionService.detectSetups(regime, indicators, candle);
      
      await this.auditRepository.create(
        decisionId,
        'SETUP',
        setups.length > 0 ? 'PASSED' : 'FAILED',
        {
          setupsFound: setups.length,
          setups: setups.map(s => ({
            type: s.type,
            direction: s.direction,
            confidence: s.confidence,
            reasoning: s.reasoning
          }))
        }
      );

      return setups;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'SETUP',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Execute trade qualification stage
   */
  private async executeTradeQualification(decisionId: string, setup: any, indicators: IndicatorData, candle: Candle) {
    try {
      const qualification = this.tradeQualificationService.qualifyTrade(setup, indicators, candle);
      
      await this.auditRepository.create(
        decisionId,
        'QUALIFICATION',
        qualification.qualified ? 'PASSED' : 'FAILED',
        {
          qualified: qualification.qualified,
          entryPrice: qualification.entryPrice,
          stopLoss: qualification.stopLoss,
          takeProfit: qualification.takeProfit,
          rrRatio: qualification.rrRatio,
          reasoning: qualification.reasoning
        }
      );

      return qualification;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'QUALIFICATION',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Execute risk management stage
   */
  private async executeRiskManagement(decisionId: string, qualification: any) {
    try {
      const risk = this.riskEngineService.calculateRisk(qualification, this.config.risk.accountBalance);
      
      await this.auditRepository.create(
        decisionId,
        'RISK',
        risk.approved ? 'PASSED' : 'FAILED',
        {
          approved: risk.approved,
          riskPercent: risk.riskPercent,
          riskAmount: risk.riskAmount,
          positionSize: risk.positionSize,
          reasoning: risk.reasoning,
          checks: risk.checks
        }
      );

      return risk;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'RISK',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Execute RR validation stage
   */
  private async executeRRValidation(decisionId: string, risk: any, qualification: any, currentPrice: number) {
    try {
      const rr = this.rrEngineService.validateRR(risk, qualification, currentPrice);
      
      await this.auditRepository.create(
        decisionId,
        'RR',
        rr.approved ? 'PASSED' : 'FAILED',
        {
          approved: rr.approved,
          rrRatio: rr.rrRatio,
          marginRequired: rr.marginRequired,
          leverageUsed: rr.leverageUsed,
          reasoning: rr.reasoning,
          checks: rr.checks
        }
      );

      return rr;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'RR',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Execute confidence scoring stage
   */
  private async executeConfidenceScoring(
    decisionId: string, regime: any, setup: any, qualification: any, risk: any, rr: any, timeContext: TimeContext
  ) {
    try {
      const confidence = this.confidenceScorer.calculateConfidence(
        regime, setup, qualification, risk, rr, timeContext
      );
      
      await this.auditRepository.create(
        decisionId,
        'CONFIDENCE',
        confidence.approved ? 'PASSED' : 'FAILED',
        {
          overallScore: confidence.overallScore,
          threshold: confidence.threshold,
          approved: confidence.approved,
          components: confidence.components
        }
      );

      return confidence;
    } catch (error) {
      await this.auditRepository.create(
        decisionId,
        'CONFIDENCE',
        'FAILED',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      throw error;
    }
  }

  /**
   * Create time context for confidence scoring
   */
  private createTimeContext(timestamp: Date): TimeContext {
    const [startHour, startMinute] = this.config.tradingWindow.start.split(':').map(Number);
    const [endHour, endMinute] = this.config.tradingWindow.end.split(':').map(Number);
    
    const windowStart = new Date(timestamp);
    windowStart.setUTCHours(startHour, startMinute, 0, 0);
    
    const windowEnd = new Date(timestamp);
    windowEnd.setUTCHours(endHour, endMinute, 0, 0);

    // Calculate time quality (higher in middle of session)
    const currentMinutes = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    let timeQuality = 0.5;
    if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
      const sessionProgress = (currentMinutes - startMinutes) / (endMinutes - startMinutes);
      // Higher quality in middle 50% of session
      if (sessionProgress >= 0.25 && sessionProgress <= 0.75) {
        timeQuality = 0.9;
      } else {
        timeQuality = 0.7;
      }
    }

    return {
      currentTime: timestamp,
      tradingWindowStart: windowStart,
      tradingWindowEnd: windowEnd,
      timeQuality
    };
  }

  /**
   * Create NO_TRADE decision
   */
  private async createNoTradeDecision(
    decisionId: string,
    candle: Candle,
    reasoning: string,
    failedStage: string
  ): Promise<StrategyDecision> {
    const decision: StrategyDecision = {
      id: decisionId,
      candleId: candle.id || '',
      pair: candle.pair,
      timeframe: candle.timeframe,
      decision: 'NO_TRADE',
      regime: 'NO_TRADE',
      confidenceScore: 0,
      reason: this.createDecisionReason(reasoning, failedStage),
      tradingWindowStart: this.config.tradingWindow.start,
      tradingWindowEnd: this.config.tradingWindow.end,
      candleTimestamp: candle.timestamp
    };

    // Store decision
    await this.decisionRepository.create(decision);
    
    this.status.totalDecisions++;
    this.status.lastProcessedCandle = candle.timestamp;

    return decision;
  }

  /**
   * Create trade decision with signal
   */
  private async createTradeDecision(
    decisionId: string,
    candle: Candle,
    direction: 'BUY' | 'SELL',
    regime: any,
    setup: any,
    confidenceScore: number,
    signal: TradeSignal
  ): Promise<StrategyDecision> {
    const decision: StrategyDecision = {
      id: decisionId,
      candleId: candle.id || '',
      pair: candle.pair,
      timeframe: candle.timeframe,
      decision: direction,
      regime: regime.regime,
      setupType: setup.type,
      confidenceScore,
      reason: this.createDecisionReason('All stages passed', 'APPROVED'),
      tradingWindowStart: this.config.tradingWindow.start,
      tradingWindowEnd: this.config.tradingWindow.end,
      candleTimestamp: candle.timestamp,
      signal
    };

    // Store decision
    const storedDecision = await this.decisionRepository.create(decision);
    
    // Store signal
    await this.signalRepository.create(signal, storedDecision.id, candle.timestamp);

    return decision;
  }

  /**
   * Create decision reasoning object
   */
  private createDecisionReason(reasoning: string, stage: string): DecisionReason {
    return {
      regime: stage === 'REGIME' ? 'FAILED' : 'PASSED',
      setup: stage === 'SETUP' ? 'FAILED' : 'PASSED',
      structure: stage === 'QUALIFICATION' ? 'FAILED' : 'PASSED',
      atr: 'PASSED',
      riskCheck: stage === 'RISK' ? 'FAILED' : 'PASSED',
      leverageCheck: stage === 'RR' ? 'FAILED' : 'PASSED',
      confidenceCheck: stage === 'CONFIDENCE' ? 'FAILED' : 'PASSED',
      timeCheck: stage === 'TIME' ? 'FAILED' : 'PASSED'
    };
  }

  /**
   * Generate unique decision ID
   */
  private generateDecisionId(): string {
    return `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Reset engine status
   */
  resetStatus(): void {
    this.status = {
      isRunning: true,
      totalDecisions: 0,
      totalSignals: 0,
      errors: []
    };
  }

  /**
   * Get monitoring service
   */
  getMonitoringService(): StrategyMonitoringService {
    return this.monitoringService;
  }

  /**
   * Stop the engine
   */
  stop(): void {
    this.status.isRunning = false;
  }

  /**
   * Start the engine
   */
  start(): void {
    this.status.isRunning = true;
  }
}