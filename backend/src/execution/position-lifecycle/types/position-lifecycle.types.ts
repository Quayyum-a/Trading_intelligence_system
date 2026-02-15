/**
 * Core types for the Position Lifecycle Engine
 */

// Position State Machine States
export enum PositionState {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LIQUIDATED = 'LIQUIDATED',
  ARCHIVED = 'ARCHIVED'
}

// Position Event Types
export enum PositionEventType {
  POSITION_CREATED = 'POSITION_CREATED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_FILLED = 'ORDER_FILLED',
  PARTIAL_FILL = 'PARTIAL_FILL',
  POSITION_OPENED = 'POSITION_OPENED',
  POSITION_UPDATED = 'POSITION_UPDATED',
  STOP_LOSS_TRIGGERED = 'STOP_LOSS_TRIGGERED',
  TAKE_PROFIT_TRIGGERED = 'TAKE_PROFIT_TRIGGERED',
  POSITION_CLOSED = 'POSITION_CLOSED',
  POSITION_LIQUIDATED = 'POSITION_LIQUIDATED'
}

// Execution Types for Position Lifecycle
export enum ExecutionType {
  ENTRY = 'ENTRY',
  PARTIAL_EXIT = 'PARTIAL_EXIT',
  FULL_EXIT = 'FULL_EXIT',
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
  LIQUIDATION = 'LIQUIDATION'
}

// Close Reasons
export enum CloseReason {
  WIN = 'WIN',
  LOSS = 'LOSS',
  MANUAL = 'MANUAL',
  LIQUIDATION = 'LIQUIDATION'
}

// Balance Event Types (Task 9 - Ledger Completeness)
export enum BalanceEventType {
  MARGIN_RESERVED = 'MARGIN_RESERVED',      // When position opens (Requirement 3.2.1)
  MARGIN_RELEASED = 'MARGIN_RELEASED',      // When position closes (Requirement 3.2.1)
  PNL_REALIZED = 'PNL_REALIZED',            // When position closes with profit/loss (Requirement 3.1.1)
  LIQUIDATION_LOSS = 'LIQUIDATION_LOSS',    // When position is liquidated
  DEPOSIT = 'DEPOSIT',                       // Manual deposit
  WITHDRAWAL = 'WITHDRAWAL'                  // Manual withdrawal
}

/**
 * Core Data Models
 */

export interface TradeExecution {
  id: string;
  positionId: string;
  orderId: string;
  executionType: ExecutionType;
  price: number;
  size: number;
  executedAt: Date;
  createdAt: Date;
}

export interface PositionEvent {
  id: string;
  positionId: string;
  eventType: PositionEventType;
  previousStatus?: PositionState;
  newStatus?: PositionState;
  payload: Record<string, any>;
  idempotencyKey?: string; // For idempotent operations (Requirements: 1.3.1, 1.3.2)
  createdAt: Date;
}

export interface AccountBalance {
  id: string;
  equity: number;
  balance: number;
  marginUsed: number;
  freeMargin: number;
  leverage: number;
  isPaper: boolean;
  updatedAt: Date;
}

export interface AccountBalanceEvent {
  id: string;
  accountId: string;
  eventType: string;
  balance_before: number;  // Renamed from previousBalance (Task 8.1)
  balance_after: number;   // Renamed from newBalance (Task 8.1)
  amount: number;          // Renamed from change (Task 8.1)
  reason: string;
  positionId?: string;     // Optional reference to position
  executionId?: string;    // Optional reference to execution
  createdAt: Date;
}

/**
 * Service Input/Output Types
 */

export interface ExecutionData {
  positionId: string;
  orderId: string;
  executionType: ExecutionType;
  price: number;
  size: number;
  executedAt: Date;
}

export interface FillData {
  orderId: string;
  price: number;
  size: number;
  executedAt: Date;
}

export interface StateTransitionResult {
  success: boolean;
  previousState: PositionState;
  newState: PositionState;
  event: PositionEvent;
  error?: string;
}

export interface PositionMetrics {
  positionId: string;
  totalPnL: number;
  unrealizedPnL: number;
  realizedPnL: number;
  roi: number;
  holdingPeriod: number;
  maxDrawdown: number;
  executionCount: number;
}

export interface BalanceChange {
  accountId: string;
  amount: number;
  reason: string;
  positionId?: string;
  executionId?: string;
}

export interface MarginStatus {
  accountId: string;
  totalMarginUsed: number;
  availableMargin: number;
  marginLevel: number;
  isMarginCall: boolean;
  isLiquidation: boolean;
}

export interface LiquidationResult {
  accountId: string;
  positionsLiquidated: string[];
  totalLoss: number;
  marginReleased: number;
  timestamp: Date;
}

/**
 * Paper Trading Types
 */

export interface SlippageConfig {
  enabled: boolean;
  maxBasisPoints: number;
  marketImpactFactor: number;
}

export interface LatencyConfig {
  enabled: boolean;
  minMs: number;
  maxMs: number;
  networkJitter: boolean;
}

export interface PaperTradingConfig {
  slippage: SlippageConfig;
  latency: LatencyConfig;
  partialFillsEnabled: boolean;
  rejectionRate: number;
}