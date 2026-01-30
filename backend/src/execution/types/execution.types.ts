/**
 * Core types for the Trade Execution Engine
 */

// Execution Trade Status Enum
export type ExecutionTradeStatus = 
  | 'NEW' 
  | 'VALIDATED' 
  | 'ORDER_PLACED' 
  | 'PARTIALLY_FILLED' 
  | 'FILLED' 
  | 'OPEN' 
  | 'CLOSED';

// Execution Close Reason Enum
export type ExecutionCloseReason = 'TP' | 'SL' | 'MANUAL' | 'ERROR';

// Order Side Enum
export type OrderSide = 'BUY' | 'SELL';

// Execution Mode Enum
export type ExecutionMode = 'PAPER' | 'MT5' | 'REST';

// Execution Event Type Enum
export type ExecutionEventType = 
  | 'CREATED' 
  | 'VALIDATED' 
  | 'ORDER_SENT' 
  | 'PARTIAL_FILL' 
  | 'FILLED' 
  | 'OPENED' 
  | 'TP_HIT' 
  | 'SL_HIT' 
  | 'MANUAL_CLOSE' 
  | 'ERROR' 
  | 'CLOSED';

// Risk Violation Types
export type RiskViolationType = 'RISK_EXCEEDED' | 'LEVERAGE_EXCEEDED' | 'INSUFFICIENT_MARGIN';

// Order Types
export type OrderType = 'MARKET' | 'LIMIT';

// Order Status
export type OrderStatus = 'PENDING' | 'FILLED' | 'REJECTED' | 'CANCELLED';

/**
 * Core Data Models
 */

export interface ExecutionTrade {
  id: string;
  tradeSignalId: string;
  pair: string;
  timeframe: string;
  side: OrderSide;
  status: ExecutionTradeStatus;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  riskPercent: number;
  leverage: number;
  rr: number;
  executionMode: ExecutionMode;
  openedAt?: Date;
  closedAt?: Date;
  closeReason?: ExecutionCloseReason;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionOrder {
  id: string;
  executionTradeId: string;
  brokerOrderId?: string;
  side: OrderSide;
  requestedPrice: number;
  requestedSize: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Execution {
  id: string;
  executionOrderId: string;
  executionTradeId: string;
  filledPrice: number;
  filledSize: number;
  slippage: number;
  executionTime: Date;
  createdAt: Date;
}

export interface Position {
  id: string;
  executionTradeId: string;
  side: OrderSide;
  size: number;
  avgEntryPrice: number;
  stopLoss: number;
  takeProfit: number;
  marginUsed: number;
  leverage: number;
  openedAt: Date;
  closedAt?: Date;
  createdAt: Date;
}

export interface ExecutionTradeEvent {
  id: string;
  executionTradeId: string;
  eventType: ExecutionEventType;
  previousStatus?: ExecutionTradeStatus;
  newStatus?: ExecutionTradeStatus;
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Trade Signal (from Strategy Engine)
 */
export interface TradeSignal {
  id: string;
  strategyDecisionId: string;
  direction: OrderSide;
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

/**
 * Execution Results and Responses
 */
export interface ExecutionResult {
  success: boolean;
  tradeId: string;
  status: ExecutionTradeStatus;
  orderId?: string;
  error?: string;
  timestamp: Date;
}

export interface RiskValidationResult {
  approved: boolean;
  violations: RiskViolation[];
  adjustedPositionSize?: number;
}

export interface RiskViolation {
  type: RiskViolationType;
  current: number;
  limit: number;
  description: string;
}

/**
 * Broker Adapter Types
 */
export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  size: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  type: OrderType;
}

export interface OrderResponse {
  orderId: string;
  status: OrderStatus;
  filledPrice?: number;
  filledSize?: number;
  timestamp: Date;
}

export interface ExecutionReport {
  orderId: string;
  tradeId: string;
  filledPrice: number;
  filledSize: number;
  slippage: number;
  timestamp: Date;
}

export interface AccountInfo {
  accountId: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
}

export interface BrokerPosition {
  positionId: string;
  symbol: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  marginUsed: number;
}

/**
 * Paper Trading Configuration
 */
export interface PaperTradingConfig {
  slippageEnabled: boolean;
  maxSlippageBps: number;
  spreadSimulation: boolean;
  latencyMs: number;
  partialFillsEnabled: boolean;
  rejectionRate: number;
  fillRule: 'NEXT_CANDLE_OPEN' | 'IMMEDIATE' | 'REALISTIC_DELAY';
}