import type { Candle } from '../types/database.js';
import type { SwingPoint } from '../indicators/indicator.interface.js';

// Core decision types
export type MarketRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGING' | 'NO_TRADE';
export type SetupType = 'PULLBACK_TO_EMA20' | 'PULLBACK_TO_EMA50' | 'STRUCTURE_BREAKOUT' | 'CONTINUATION_AFTER_SWEEP';
export type TradeDirection = 'BUY' | 'SELL';
export type DecisionType = 'BUY' | 'SELL' | 'NO_TRADE';

// Input data interfaces
export interface IndicatorData {
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
}

// Market regime analysis
export interface EMAAlignment {
  ema20: number;
  ema50: number;
  ema200: number;
  alignment: 'BULLISH' | 'BEARISH' | 'MIXED' | 'FLAT';
  strength: number; // 0-1
}

export interface SwingStructure {
  recentHighs: SwingPoint[];
  recentLows: SwingPoint[];
  trend: 'HIGHER_HIGHS_LOWS' | 'LOWER_HIGHS_LOWS' | 'SIDEWAYS';
  quality: number; // 0-1
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  confidence: number;
  emaAlignment: EMAAlignment;
  swingStructure: SwingStructure;
  reasoning: string;
}

// Setup detection
export interface ValidationCheck {
  name: string;
  passed: boolean;
  value?: number;
  threshold?: number;
  description: string;
}

export interface SetupResult {
  type: SetupType;
  direction: TradeDirection;
  confidence: number;
  entryPrice: number;
  reasoning: string;
  validationChecks: ValidationCheck[];
}

// Trade qualification
export interface StructureAnalysis {
  relevantSwing: SwingPoint;
  atrBuffer: number;
  stopBeyondStructure: boolean;
  stopDistance: number;
  invalidationLevel: number;
}

export interface QualificationResult {
  qualified: boolean;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  stopDistance?: number;
  rrRatio?: number;
  reasoning: string;
  structureAnalysis: StructureAnalysis;
}

// Risk management
export interface RiskCheck {
  name: string;
  passed: boolean;
  actual: number;
  limit: number;
  description: string;
}

export interface RiskResult {
  approved: boolean;
  riskPercent: number;
  riskAmount: number;
  positionSize: number;
  stopDistance: number;
  reasoning: string;
  checks: RiskCheck[];
}

// Leverage validation
export interface LeverageCheck {
  name: string;
  passed: boolean;
  actual: number;
  limit: number;
  description: string;
}

export interface RRResult {
  approved: boolean;
  rrRatio: number;
  marginRequired: number;
  marginPercent: number;
  leverageUsed: number;
  reasoning: string;
  checks: LeverageCheck[];
}

// Confidence scoring
export interface ConfidenceComponent {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  description: string;
}

export interface TimeContext {
  currentTime: Date;
  tradingWindowStart: Date;
  tradingWindowEnd: Date;
  timeQuality: number; // 0-1, higher during optimal trading hours
}

export interface ConfidenceResult {
  overallScore: number;
  components: ConfidenceComponent[];
  threshold: number;
  approved: boolean;
}

// Final decision output
export interface DecisionReason {
  regime: string;
  setup?: string;
  structure?: string;
  atr: string;
  riskCheck: string;
  leverageCheck: string;
  confidenceCheck: string;
  timeCheck: string;
}

export interface TradeSignal {
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskPercent: number;
  leverage: number;
  positionSize: number;
  marginRequired: number;
}

export interface StrategyDecision {
  id: string;
  candleId: string;
  pair: string;
  timeframe: string;
  decision: DecisionType;
  regime: MarketRegime;
  setupType?: SetupType;
  confidenceScore: number;
  reason: DecisionReason;
  tradingWindowStart: string;
  tradingWindowEnd: string;
  candleTimestamp: Date;
  signal?: TradeSignal;
}

// Configuration interfaces
export interface ConfidenceWeights {
  emaAlignment: number;
  structureQuality: number;
  atrContext: number;
  timeOfDay: number;
  rrQuality: number;
}

export interface StrategyConfig {
  pair: string;
  timeframe: string;
  tradingWindow: {
    start: string; // "14:00"
    end: string;   // "18:00"
    timezone: string;
  };
  risk: {
    riskPerTrade: number; // 0.01
    maxConcurrentTrades: number; // 1
    leverage: number; // 200
    minRRRatio: number; // 2.0
    accountBalance: number;
  };
  confidence: {
    minThreshold: number; // 0.7
    components: ConfidenceWeights;
  };
  regime: {
    emaAlignmentWeight: number;
    swingStructureWeight: number;
    atrVolatilityThreshold: number;
  };
  setup: {
    pullbackToleranceATR: number; // 0.5
    breakoutConfirmationATR: number; // 1.0
    sweepToleranceATR: number; // 0.3
  };
}

// Database record interfaces
export interface StrategyDecisionRecord {
  id: string;
  candleId: string;
  pair: string;
  timeframe: string;
  decision: DecisionType;
  regime: MarketRegime;
  setupType?: SetupType;
  confidenceScore: number;
  reason: object; // JSON containing full reasoning
  tradingWindowStart: string;
  tradingWindowEnd: string;
  candleTimestamp: Date;
  createdAt: Date;
}

export interface TradeSignalRecord {
  id: string;
  strategyDecisionId: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskPercent: number;
  leverage: number;
  positionSize: number;
  marginRequired: number;
  candleTimestamp: Date;
  createdAt: Date;
}

export interface StrategyAuditRecord {
  id: string;
  strategyDecisionId: string;
  stage: 'REGIME' | 'SETUP' | 'QUALIFICATION' | 'RISK' | 'RR' | 'CONFIDENCE' | 'TIME';
  status: 'PASSED' | 'FAILED';
  details: object; // JSON containing stage-specific data
  createdAt: Date;
}

export interface StrategyRunRecord {
  id: string;
  pair: string;
  timeframe: string;
  runType: 'HISTORICAL' | 'INCREMENTAL';
  candlesProcessed: number;
  tradesGenerated: number;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
}

// Service interfaces
export interface MarketRegimeService {
  detectRegime(indicators: IndicatorData): MarketRegimeResult;
}

export interface SetupDetectionService {
  detectSetups(regime: MarketRegimeResult, indicators: IndicatorData, candle: Candle): SetupResult[];
}

export interface TradeQualificationService {
  qualifyTrade(setup: SetupResult, indicators: IndicatorData, candle: Candle): QualificationResult;
}

export interface RiskEngineService {
  calculateRisk(qualification: QualificationResult, accountBalance: number): RiskResult;
}

export interface RREngineService {
  validateRR(risk: RiskResult, qualification: QualificationResult, currentPrice: number): RRResult;
}

export interface ConfidenceScorer {
  calculateConfidence(
    regime: MarketRegimeResult,
    setup: SetupResult,
    qualification: QualificationResult,
    risk: RiskResult,
    rr: RRResult,
    timeContext: TimeContext
  ): ConfidenceResult;
}

export interface EngineStatus {
  isRunning: boolean;
  lastProcessedCandle?: Date;
  totalDecisions: number;
  totalSignals: number;
  errors: string[];
}

export interface StrategyEngine {
  processCandle(candle: Candle, indicators: IndicatorData): Promise<StrategyDecision>;
  validateTradingWindow(timestamp: Date): boolean;
  getEngineStatus(): EngineStatus;
}