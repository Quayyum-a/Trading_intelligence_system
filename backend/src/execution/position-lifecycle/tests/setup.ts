/**
 * Test setup for position lifecycle engine testing
 */

import fc from 'fast-check';
import { 
  PositionState, 
  ExecutionType, 
  PositionEventType,
  ExecutionData,
  FillData,
  PositionMetrics
} from '../types/position-lifecycle.types';
import { TradeSignal } from '../../types/execution.types';
import { randomUUID } from 'crypto';

/**
 * Property-based test generators for position lifecycle engine
 */

// Generate valid position states
export const positionStateArbitrary = fc.constantFrom(
  PositionState.PENDING,
  PositionState.OPEN,
  PositionState.CLOSED,
  PositionState.LIQUIDATED,
  PositionState.ARCHIVED
);

// Generate valid execution types
export const executionTypeArbitrary = fc.constantFrom(
  ExecutionType.ENTRY,
  ExecutionType.PARTIAL_EXIT,
  ExecutionType.FULL_EXIT,
  ExecutionType.STOP_LOSS,
  ExecutionType.TAKE_PROFIT,
  ExecutionType.LIQUIDATION
);

// Generate valid position event types
export const positionEventTypeArbitrary = fc.constantFrom(
  PositionEventType.POSITION_CREATED,
  PositionEventType.ORDER_PLACED,
  PositionEventType.ORDER_FILLED,
  PositionEventType.PARTIAL_FILL,
  PositionEventType.POSITION_OPENED,
  PositionEventType.POSITION_UPDATED,
  PositionEventType.STOP_LOSS_TRIGGERED,
  PositionEventType.TAKE_PROFIT_TRIGGERED,
  PositionEventType.POSITION_CLOSED,
  PositionEventType.POSITION_LIQUIDATED
);

// Generate valid order sides
export const orderSideArbitrary = fc.constantFrom('BUY', 'SELL');

// Generate valid prices (realistic forex/gold prices)
export const priceArbitrary = fc.double({ min: 1000, max: 3000 });

// Generate valid position sizes
export const positionSizeArbitrary = fc.double({ min: 0.01, max: 2.0 });

// Generate valid leverage values
export const leverageArbitrary = fc.integer({ min: 1, max: 200 });

// Generate valid risk percentages
export const riskPercentArbitrary = fc.double({ min: 0.001, max: 0.01 });

// Generate currency pairs
export const currencyPairArbitrary = fc.constantFrom('XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF');

// Generate timeframes
export const timeframeArbitrary = fc.constantFrom('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1');

// Generate trade signals for position lifecycle testing
export const tradeSignalArbitrary: fc.Arbitrary<TradeSignal> = fc.record({
  id: fc.constant(randomUUID()),
  direction: orderSideArbitrary,
  entryPrice: priceArbitrary,
  positionSize: positionSizeArbitrary,
  leverage: leverageArbitrary,
  marginRequired: fc.double({ min: 100, max: 2000 }),
  stopLoss: priceArbitrary,
  takeProfit: priceArbitrary
});

// Generate execution data
export const executionDataArbitrary: fc.Arbitrary<ExecutionData> = fc.record({
  positionId: fc.uuid(),
  orderId: fc.uuid(),
  executionType: executionTypeArbitrary,
  price: priceArbitrary,
  size: positionSizeArbitrary,
  executedAt: fc.date()
});

// Generate fill data
export const fillDataArbitrary: fc.Arbitrary<FillData> = fc.record({
  orderId: fc.uuid(),
  price: priceArbitrary,
  size: positionSizeArbitrary,
  executedAt: fc.date()
});

// Generate position metrics
export const positionMetricsArbitrary: fc.Arbitrary<PositionMetrics> = fc.record({
  positionId: fc.uuid(),
  totalPnL: fc.double({ min: -1000, max: 1000 }),
  unrealizedPnL: fc.double({ min: -500, max: 500 }),
  realizedPnL: fc.double({ min: -500, max: 500 }),
  roi: fc.double({ min: -100, max: 100 }),
  holdingPeriod: fc.double({ min: 0.1, max: 168 }), // Hours
  maxDrawdown: fc.double({ min: 0, max: 100 }),
  executionCount: fc.integer({ min: 1, max: 10 })
});

/**
 * Test configuration for property-based tests
 */
export const PROPERTY_TEST_CONFIG = {
  numRuns: 100, // Minimum 100 iterations as specified in design
  timeout: 10000,
  verbose: false,
  seed: 42 // For reproducible tests
};

/**
 * Helper functions for position lifecycle testing
 */

export function isValidStateTransition(from: PositionState, to: PositionState): boolean {
  const validTransitions: Record<PositionState, PositionState[]> = {
    [PositionState.PENDING]: [PositionState.OPEN, PositionState.CLOSED],
    [PositionState.OPEN]: [PositionState.CLOSED, PositionState.LIQUIDATED],
    [PositionState.CLOSED]: [PositionState.ARCHIVED],
    [PositionState.LIQUIDATED]: [PositionState.ARCHIVED],
    [PositionState.ARCHIVED]: []
  };

  return validTransitions[from]?.includes(to) ?? false;
}

export function isValidExecutionType(executionType: ExecutionType): boolean {
  return Object.values(ExecutionType).includes(executionType);
}

export function isValidPositionEventType(eventType: PositionEventType): boolean {
  return Object.values(PositionEventType).includes(eventType);
}

export function calculateExpectedPnL(
  entryPrice: number,
  currentPrice: number,
  size: number,
  side: 'BUY' | 'SELL',
  commissionRate: number = 0.0001
): number {
  const priceDiff = side === 'BUY' 
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  
  const grossPnL = priceDiff * size;
  const commission = currentPrice * size * commissionRate;
  
  return grossPnL - commission;
}

export function calculateMarginRequirement(
  price: number,
  size: number,
  leverage: number
): number {
  const notionalValue = price * size;
  return notionalValue / leverage;
}

export function isValidRiskParameters(
  riskPercent: number,
  leverage: number,
  maxRisk: number = 0.01,
  maxLeverage: number = 200
): boolean {
  return riskPercent <= maxRisk && leverage <= maxLeverage;
}

export function generateRealisticPriceMovement(
  basePrice: number,
  volatilityPercent: number = 2.0
): number {
  const maxMove = basePrice * (volatilityPercent / 100);
  const movement = (Math.random() - 0.5) * 2 * maxMove;
  return Math.max(basePrice + movement, basePrice * 0.5); // Prevent negative prices
}

export function generateRealisticSlippage(
  basePrice: number,
  maxSlippageBps: number = 5
): number {
  const slippagePercent = (Math.random() * maxSlippageBps) / 10000;
  const slippage = basePrice * slippagePercent;
  return Math.random() > 0.5 ? slippage : -slippage;
}

/**
 * Mock data generators for testing
 */

export function createMockPosition(overrides: Partial<any> = {}): any {
  return {
    id: randomUUID(),
    executionTradeId: randomUUID(),
    pair: 'XAUUSD',
    side: 'BUY',
    size: 0.1,
    avgEntryPrice: 2000.00,
    leverage: 100,
    marginUsed: 200.00,
    unrealizedPnL: 0,
    realizedPnL: 0,
    status: PositionState.PENDING,
    openedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function createMockTradeExecution(overrides: Partial<any> = {}): any {
  return {
    id: randomUUID(),
    positionId: randomUUID(),
    orderId: randomUUID(),
    executionType: ExecutionType.ENTRY,
    price: 2000.00,
    size: 0.1,
    executedAt: new Date(),
    createdAt: new Date(),
    ...overrides
  };
}

export function createMockPositionEvent(overrides: Partial<any> = {}): any {
  return {
    id: randomUUID(),
    positionId: randomUUID(),
    eventType: PositionEventType.POSITION_CREATED,
    previousStatus: null,
    newStatus: PositionState.PENDING,
    payload: {},
    createdAt: new Date(),
    ...overrides
  };
}

export function createMockAccountBalance(overrides: Partial<any> = {}): any {
  return {
    id: randomUUID(),
    equity: 10000,
    balance: 10000,
    marginUsed: 0,
    freeMargin: 10000,
    leverage: 100,
    isPaper: true,
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Test utilities for database operations
 */

export async function cleanupTestData(
  supabase: any,
  positionIds: string[],
  accountIds: string[] = []
): Promise<void> {
  try {
    // Clean up in reverse dependency order
    if (positionIds.length > 0) {
      await supabase.from('position_events').delete().in('position_id', positionIds);
      await supabase.from('trade_executions').delete().in('position_id', positionIds);
      await supabase.from('positions').delete().in('id', positionIds);
    }
    
    if (accountIds.length > 0) {
      await supabase.from('account_balance_events').delete().in('account_id', accountIds);
      await supabase.from('account_balances').delete().in('id', accountIds);
    }
  } catch (error) {
    console.warn('Cleanup failed:', error);
  }
}

export async function createTestAccount(
  supabase: any,
  balance: number = 10000
): Promise<string> {
  const accountId = randomUUID();
  
  await supabase.from('account_balances').insert({
    id: accountId,
    equity: balance,
    balance: balance,
    marginUsed: 0,
    freeMargin: balance,
    leverage: 100,
    isPaper: true
  });
  
  return accountId;
}

/**
 * Performance testing utilities
 */

export function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  return new Promise(async (resolve, reject) => {
    const startTime = Date.now();
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      resolve({ result, duration });
    } catch (error) {
      reject(error);
    }
  });
}

export function createPerformanceThresholds() {
  return {
    positionCreation: 1000, // 1 second
    executionProcessing: 500, // 500ms
    pnlCalculation: 100, // 100ms
    stateTransition: 200, // 200ms
    eventRecording: 150, // 150ms
    integrityCheck: 2000 // 2 seconds
  };
}

/**
 * Validation utilities
 */

export function validatePositionIntegrity(position: any): boolean {
  return (
    position.id &&
    position.status &&
    Object.values(PositionState).includes(position.status) &&
    position.size >= 0 &&
    position.avgEntryPrice > 0 &&
    position.leverage > 0 &&
    position.marginUsed >= 0
  );
}

export function validateExecutionIntegrity(execution: any): boolean {
  return (
    execution.id &&
    execution.positionId &&
    execution.executionType &&
    Object.values(ExecutionType).includes(execution.executionType) &&
    execution.price > 0 &&
    execution.size > 0 &&
    execution.executedAt
  );
}

export function validateEventIntegrity(event: any): boolean {
  return (
    event.id &&
    event.positionId &&
    event.eventType &&
    Object.values(PositionEventType).includes(event.eventType) &&
    event.createdAt
  );
}