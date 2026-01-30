/**
 * Test setup for execution engine property-based testing
 */

import fc from 'fast-check';
import { 
  ExecutionTradeStatus, 
  OrderSide, 
  ExecutionMode, 
  TradeSignal,
  ExecutionTrade 
} from '../types/execution.types';

/**
 * Property-based test generators
 */

// Generate valid order sides
export const orderSideArbitrary = fc.constantFrom('BUY', 'SELL') as fc.Arbitrary<OrderSide>;

// Generate valid execution modes
export const executionModeArbitrary = fc.constantFrom('PAPER', 'MT5', 'REST') as fc.Arbitrary<ExecutionMode>;

// Generate valid execution trade statuses
export const executionTradeStatusArbitrary = fc.constantFrom(
  'NEW', 'VALIDATED', 'ORDER_PLACED', 'PARTIALLY_FILLED', 'FILLED', 'OPEN', 'CLOSED'
) as fc.Arbitrary<ExecutionTradeStatus>;

// Generate valid risk percentages (0.001 to 0.01)
export const riskPercentArbitrary = fc.double({ min: 0.001, max: 0.01 });

// Generate valid leverage (1 to 200)
export const leverageArbitrary = fc.integer({ min: 1, max: 200 });

// Generate valid prices (positive numbers)
export const priceArbitrary = fc.double({ min: 0.01, max: 10000 });

// Generate valid position sizes
export const positionSizeArbitrary = fc.double({ min: 0.01, max: 100 });

// Generate currency pairs
export const currencyPairArbitrary = fc.constantFrom('XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY');

// Generate timeframes
export const timeframeArbitrary = fc.constantFrom('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1');

// Generate trade signals
export const tradeSignalArbitrary: fc.Arbitrary<TradeSignal> = fc.record({
  id: fc.uuid(),
  strategyDecisionId: fc.uuid(),
  direction: orderSideArbitrary,
  entryPrice: priceArbitrary,
  stopLoss: priceArbitrary,
  takeProfit: priceArbitrary,
  rrRatio: fc.double({ min: 1, max: 5 }),
  riskPercent: riskPercentArbitrary,
  leverage: leverageArbitrary,
  positionSize: positionSizeArbitrary,
  marginRequired: fc.double({ min: 100, max: 10000 }),
  candleTimestamp: fc.date(),
  createdAt: fc.date()
});

// Generate execution trades
export const executionTradeArbitrary: fc.Arbitrary<ExecutionTrade> = fc.record({
  id: fc.uuid(),
  tradeSignalId: fc.uuid(),
  pair: currencyPairArbitrary,
  timeframe: timeframeArbitrary,
  side: orderSideArbitrary,
  status: executionTradeStatusArbitrary,
  entryPrice: priceArbitrary,
  stopLoss: priceArbitrary,
  takeProfit: priceArbitrary,
  positionSize: positionSizeArbitrary,
  riskPercent: riskPercentArbitrary,
  leverage: leverageArbitrary,
  rr: fc.double({ min: 1, max: 5 }),
  executionMode: executionModeArbitrary,
  openedAt: fc.option(fc.date()),
  closedAt: fc.option(fc.date()),
  closeReason: fc.option(fc.constantFrom('TP', 'SL', 'MANUAL', 'ERROR')),
  createdAt: fc.date(),
  updatedAt: fc.date()
});

/**
 * Test configuration
 */
export const PROPERTY_TEST_CONFIG = {
  numRuns: 100, // Minimum 100 iterations as specified in design
  timeout: 5000,
  verbose: false
};

/**
 * Helper functions for property testing
 */

export function isValidStateTransition(from: ExecutionTradeStatus, to: ExecutionTradeStatus): boolean {
  const validTransitions: Record<ExecutionTradeStatus, ExecutionTradeStatus[]> = {
    'NEW': ['VALIDATED'],
    'VALIDATED': ['ORDER_PLACED'],
    'ORDER_PLACED': ['PARTIALLY_FILLED', 'FILLED'],
    'PARTIALLY_FILLED': ['FILLED'],
    'FILLED': ['OPEN'],
    'OPEN': ['CLOSED'],
    'CLOSED': []
  };

  return validTransitions[from]?.includes(to) ?? false;
}

export function isValidRiskParameters(riskPercent: number, leverage: number): boolean {
  return riskPercent <= 0.01 && leverage <= 200;
}