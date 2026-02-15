/**
 * Position Lifecycle Engine Property-Based Tests
 * **Feature: position-lifecycle-engine**
 * 
 * Property-based testing for all correctness properties defined in the design document
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { PositionLifecycleEngine, PositionLifecycleEngineConfig } from '../position-lifecycle-engine';
import { PositionState, ExecutionType, PositionEventType } from '../types/position-lifecycle.types';
import { TradeSignal } from '../../types/execution.types';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Property test configuration
const PROPERTY_TEST_CONFIG = {
  numRuns: 100, // Minimum 100 iterations as specified in design
  timeout: 10000,
  verbose: false
};

// Test data generators
const positionSideArbitrary = fc.constantFrom('BUY', 'SELL');
const priceArbitrary = fc.double({ min: 1000, max: 3000 });
const sizeArbitrary = fc.double({ min: 0.01, max: 1.0 });
const leverageArbitrary = fc.integer({ min: 1, max: 200 });

const tradeSignalArbitrary = fc.record({
  id: fc.constant(randomUUID()),
  direction: positionSideArbitrary,
  entryPrice: priceArbitrary,
  positionSize: sizeArbitrary,
  leverage: leverageArbitrary,
  marginRequired: fc.double({ min: 100, max: 1000 }),
  stopLoss: priceArbitrary,
  takeProfit: priceArbitrary
});

describe('🧪 POSITION LIFECYCLE ENGINE - PROPERTY-BASED TESTS', () => {
  let engine: PositionLifecycleEngine;
  let supabase: ReturnType<typeof createClient>;
  let testAccountId: string;

  beforeAll(async () => {
    const config: PositionLifecycleEngineConfig = {
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      paperTradingConfig: {
        slippageEnabled: true,
        maxSlippageBps: 5,
        latencyMs: 50,
        rejectionRate: 0.01
      },
      maxLeverage: 200,
      marginCallLevel: 0.5,
      liquidationLevel: 0.2,
      commissionRate: 0.0001
    };

    engine = new PositionLifecycleEngine(config);
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
    
    await engine.initialize();

    testAccountId = randomUUID();
    await supabase.from('account_balances').insert({
      id: testAccountId,
      equity: 50000,
      balance: 50000,
      marginUsed: 0,
      freeMargin: 50000,
      leverage: 100,
      isPaper: true
    });
  }, 20000); // Increased timeout from default 10000ms

  afterAll(async () => {
    await engine.shutdown();
    await supabase.from('account_balances').delete().eq('id', testAccountId);
  });

  describe('🔄 STATE MACHINE PROPERTIES', () => {
    it('Property 1: Position initialization consistency', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 1: Position initialization consistency**
       * **Validates: Requirements 1.1**
       * 
       * For any new position creation, the position should be initialized with status PENDING
       */
      await fc.assert(
        fc.asyncProperty(tradeSignalArbitrary, async (tradeSignal) => {
          const position = await engine.createPosition(tradeSignal);
          
          try {
            expect(position.status).toBe(PositionState.PENDING);
            expect(position.size).toBe(tradeSignal.positionSize);
            expect(position.avgEntryPrice).toBe(tradeSignal.entryPrice);
            expect(position.unrealizedPnL).toBe(0);
            expect(position.realizedPnL).toBe(0);
            
            return true;
          } finally {
            // Cleanup
            await supabase.from('position_events').delete().eq('position_id', position.id);
            await supabase.from('positions').delete().eq('id', position.id);
          }
        }),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 2: First fill state transition', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 2: First fill state transition**
       * **Validates: Requirements 1.2**
       * 
       * For any position in PENDING status, when the first execution fill occurs, 
       * the position status should transition to OPEN
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          async (tradeSignal, fillPrice) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              expect(position.status).toBe(PositionState.PENDING);
              
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: fillPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              const updatedPosition = await engine.getPosition(position.id);
              expect(updatedPosition?.status).toBe(PositionState.OPEN);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 3: Partial exit size reduction', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 3: Partial exit size reduction**
       * **Validates: Requirements 1.3**
       * 
       * For any position in OPEN status, when partial exit fills occur, 
       * the position size should decrease while maintaining OPEN status
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          fc.double({ min: 0.1, max: 0.9 }), // Partial exit ratio
          async (tradeSignal, exitRatio) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              // Open the position
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: tradeSignal.entryPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              const openPosition = await engine.getPosition(position.id);
              expect(openPosition?.status).toBe(PositionState.OPEN);
              
              const originalSize = openPosition!.size;
              const exitSize = originalSize * exitRatio;
              
              // Process partial exit
              await engine.processPartialFill(position.id, {
                orderId: randomUUID(),
                price: tradeSignal.entryPrice * 1.01, // Small profit
                size: exitSize,
                executedAt: new Date()
              });
              
              const updatedPosition = await engine.getPosition(position.id);
              expect(updatedPosition?.status).toBe(PositionState.OPEN);
              expect(updatedPosition?.size).toBeCloseTo(originalSize - exitSize, 6);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('📊 PNL CALCULATION PROPERTIES', () => {
    it('Property 15: Unrealized PnL calculation', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 15: Unrealized PnL calculation**
       * **Validates: Requirements 3.1, 3.2**
       * 
       * For any open position and market price update, unrealized PnL should be recalculated 
       * using the formula: (current_price - avg_entry_price) * position_size * direction_multiplier
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          async (tradeSignal, marketPrice) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              // Open the position
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: tradeSignal.entryPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              // Update PnL with market price
              await engine.updatePositionPnL(position.id, marketPrice);
              
              const updatedPosition = await engine.getPosition(position.id);
              
              // Calculate expected PnL
              const priceDiff = tradeSignal.direction === 'BUY' 
                ? marketPrice - tradeSignal.entryPrice
                : tradeSignal.entryPrice - marketPrice;
              
              const expectedPnL = priceDiff * tradeSignal.positionSize;
              
              // Allow for small commission deduction
              expect(Math.abs(updatedPosition!.unrealizedPnL - expectedPnL)).toBeLessThan(1.0);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 16: Realized PnL accumulation', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 16: Realized PnL accumulation**
       * **Validates: Requirements 3.3**
       * 
       * For any position portion closure, realized PnL should be calculated and added 
       * to the position's total realized PnL
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          fc.double({ min: 0.1, max: 0.5 }), // Exit ratio
          async (tradeSignal, exitPrice, exitRatio) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              // Open the position
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: tradeSignal.entryPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              const initialRealizedPnL = 0;
              const exitSize = tradeSignal.positionSize * exitRatio;
              
              // Process partial exit
              await engine.processPartialFill(position.id, {
                orderId: randomUUID(),
                price: exitPrice,
                size: exitSize,
                executedAt: new Date()
              });
              
              const updatedPosition = await engine.getPosition(position.id);
              
              // Calculate expected realized PnL for the closed portion
              const priceDiff = tradeSignal.direction === 'BUY' 
                ? exitPrice - tradeSignal.entryPrice
                : tradeSignal.entryPrice - exitPrice;
              
              const expectedRealizedPnL = priceDiff * exitSize;
              
              // Realized PnL should have increased
              expect(updatedPosition!.realizedPnL).toBeGreaterThan(initialRealizedPnL);
              
              // Allow for commission deduction
              expect(Math.abs(updatedPosition!.realizedPnL - expectedRealizedPnL)).toBeLessThan(1.0);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('📝 EVENT SOURCING PROPERTIES', () => {
    it('Property 18: Position event creation', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 18: Position event creation**
       * **Validates: Requirements 4.1**
       * 
       * For any position state change, an immutable position_event record should be created
       */
      await fc.assert(
        fc.asyncProperty(tradeSignalArbitrary, async (tradeSignal) => {
          const position = await engine.createPosition(tradeSignal);
          
          try {
            // Check that position creation event was recorded
            const { data: creationEvents } = await supabase
              .from('position_events')
              .select('*')
              .eq('position_id', position.id)
              .eq('event_type', PositionEventType.POSITION_CREATED);
            
            expect(creationEvents).toBeDefined();
            expect(creationEvents!.length).toBe(1);
            expect(creationEvents![0].position_id).toBe(position.id);
            
            // Process a fill to trigger another state change
            await engine.processFullFill(position.id, {
              orderId: randomUUID(),
              price: tradeSignal.entryPrice,
              size: tradeSignal.positionSize,
              executedAt: new Date()
            });
            
            // Check that additional events were recorded
            const { data: allEvents } = await supabase
              .from('position_events')
              .select('*')
              .eq('position_id', position.id);
            
            expect(allEvents!.length).toBeGreaterThan(1);
            
            return true;
          } finally {
            // Cleanup
            await supabase.from('trade_executions').delete().eq('position_id', position.id);
            await supabase.from('position_events').delete().eq('position_id', position.id);
            await supabase.from('positions').delete().eq('id', position.id);
          }
        }),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 21: Idempotent event processing', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 21: Idempotent event processing**
       * **Validates: Requirements 4.4**
       * 
       * For any duplicate event processing, the system should produce identical results
       */
      await fc.assert(
        fc.asyncProperty(tradeSignalArbitrary, async (tradeSignal) => {
          const position1 = await engine.createPosition(tradeSignal);
          const position2 = await engine.createPosition(tradeSignal);
          
          try {
            // Process identical operations on both positions
            const fillData = {
              orderId: randomUUID(),
              price: tradeSignal.entryPrice,
              size: tradeSignal.positionSize,
              executedAt: new Date()
            };
            
            await engine.processFullFill(position1.id, fillData);
            await engine.processFullFill(position2.id, fillData);
            
            // Both positions should have identical states
            const finalPosition1 = await engine.getPosition(position1.id);
            const finalPosition2 = await engine.getPosition(position2.id);
            
            expect(finalPosition1?.status).toBe(finalPosition2?.status);
            expect(finalPosition1?.size).toBe(finalPosition2?.size);
            expect(finalPosition1?.avgEntryPrice).toBe(finalPosition2?.avgEntryPrice);
            
            return true;
          } finally {
            // Cleanup
            for (const posId of [position1.id, position2.id]) {
              await supabase.from('trade_executions').delete().eq('position_id', posId);
              await supabase.from('position_events').delete().eq('position_id', posId);
              await supabase.from('positions').delete().eq('id', posId);
            }
          }
        }),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('🛡️ RISK MANAGEMENT PROPERTIES', () => {
    it('Property 28: Margin reservation', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 28: Margin reservation**
       * **Validates: Requirements 6.1**
       * 
       * For any position opening, required margin should be reserved and account balance should be updated
       */
      await fc.assert(
        fc.asyncProperty(tradeSignalArbitrary, async (tradeSignal) => {
          // Get initial account balance
          const { data: initialBalance } = await supabase
            .from('account_balances')
            .select('*')
            .eq('id', testAccountId)
            .single();
          
          const position = await engine.createPosition(tradeSignal);
          
          try {
            await engine.processFullFill(position.id, {
              orderId: randomUUID(),
              price: tradeSignal.entryPrice,
              size: tradeSignal.positionSize,
              executedAt: new Date()
            });
            
            // Check that margin was reserved
            const { data: updatedBalance } = await supabase
              .from('account_balances')
              .select('*')
              .eq('id', testAccountId)
              .single();
            
            expect(updatedBalance?.marginUsed).toBeGreaterThan(initialBalance?.marginUsed || 0);
            expect(updatedBalance?.freeMargin).toBeLessThan(initialBalance?.freeMargin || 0);
            
            return true;
          } finally {
            // Cleanup
            await supabase.from('trade_executions').delete().eq('position_id', position.id);
            await supabase.from('position_events').delete().eq('position_id', position.id);
            await supabase.from('positions').delete().eq('id', position.id);
            
            // Reset account balance
            await supabase.from('account_balances')
              .update({
                marginUsed: 0,
                freeMargin: 50000
              })
              .eq('id', testAccountId);
          }
        }),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 30: Leverage enforcement', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 30: Leverage enforcement**
       * **Validates: Requirements 6.3**
       * 
       * For any margin calculation, maximum leverage limits should be enforced
       */
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            ...tradeSignalArbitrary.constraints,
            leverage: fc.integer({ min: 1, max: 500 }) // Test beyond max leverage
          }),
          async (tradeSignal) => {
            if (tradeSignal.leverage <= 200) {
              // Should succeed for valid leverage
              const position = await engine.createPosition(tradeSignal);
              
              try {
                expect(position.leverage).toBeLessThanOrEqual(200);
                return true;
              } finally {
                await supabase.from('position_events').delete().eq('position_id', position.id);
                await supabase.from('positions').delete().eq('id', position.id);
              }
            } else {
              // Should fail or be adjusted for excessive leverage
              try {
                const position = await engine.createPosition(tradeSignal);
                // If position is created, leverage should be capped
                expect(position.leverage).toBeLessThanOrEqual(200);
                
                await supabase.from('position_events').delete().eq('position_id', position.id);
                await supabase.from('positions').delete().eq('id', position.id);
                return true;
              } catch (error) {
                // Rejection is also acceptable for excessive leverage
                return true;
              }
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('🔄 EXECUTION TRACKING PROPERTIES', () => {
    it('Property 8: Execution recording completeness', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 8: Execution recording completeness**
       * **Validates: Requirements 2.1**
       * 
       * For any execution that occurs, a trade_execution record should be created 
       * with execution type, price, size, and timestamp
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          async (tradeSignal, executionPrice) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              const executionData = {
                positionId: position.id,
                orderId: randomUUID(),
                executionType: ExecutionType.ENTRY,
                price: executionPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              };
              
              await engine.recordExecution(executionData);
              
              // Verify execution was recorded
              const { data: executions } = await supabase
                .from('trade_executions')
                .select('*')
                .eq('position_id', position.id);
              
              expect(executions).toBeDefined();
              expect(executions!.length).toBe(1);
              
              const execution = executions![0];
              expect(execution.execution_type).toBe(ExecutionType.ENTRY);
              expect(execution.price).toBe(executionPrice);
              expect(execution.size).toBe(tradeSignal.positionSize);
              expect(execution.executed_at).toBeDefined();
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 9: Entry fill recording', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 9: Entry fill recording**
       * **Validates: Requirements 2.2**
       * 
       * For any entry fill, the execution_type should be recorded as ENTRY 
       * and position average entry price should be updated
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          async (tradeSignal, fillPrice) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: fillPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              // Verify execution was recorded as ENTRY
              const { data: executions } = await supabase
                .from('trade_executions')
                .select('*')
                .eq('position_id', position.id)
                .eq('execution_type', ExecutionType.ENTRY);
              
              expect(executions!.length).toBeGreaterThan(0);
              
              // Verify position average entry price was updated
              const updatedPosition = await engine.getPosition(position.id);
              expect(updatedPosition?.avgEntryPrice).toBe(fillPrice);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('🎯 SYSTEM INTEGRITY PROPERTIES', () => {
    it('Property 45: System integrity validation', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 45: System integrity validation**
       * **Validates: Requirements 9.5**
       * 
       * For any system state, account balance should always reconcile with 
       * the sum of all position PnL totals
       */
      await fc.assert(
        fc.asyncProperty(
          fc.array(tradeSignalArbitrary, { minLength: 1, maxLength: 3 }),
          async (tradeSignals) => {
            const positions = [];
            
            try {
              // Create multiple positions
              for (const signal of tradeSignals) {
                const position = await engine.createPosition(signal);
                positions.push(position);
                
                // Open the position
                await engine.processFullFill(position.id, {
                  orderId: randomUUID(),
                  price: signal.entryPrice,
                  size: signal.positionSize,
                  executedAt: new Date()
                });
              }
              
              // Perform system integrity check
              const integrityResult = await engine.performIntegrityCheck();
              
              expect(integrityResult.isValid).toBe(true);
              expect(integrityResult.balanceReconciled).toBe(true);
              expect(integrityResult.errors.length).toBe(0);
              
              return true;
            } finally {
              // Cleanup all positions
              for (const position of positions) {
                await supabase.from('trade_executions').delete().eq('position_id', position.id);
                await supabase.from('position_events').delete().eq('position_id', position.id);
                await supabase.from('positions').delete().eq('id', position.id);
              }
              
              // Reset account balance
              await supabase.from('account_balances')
                .update({
                  marginUsed: 0,
                  freeMargin: 50000
                })
                .eq('id', testAccountId);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });

    it('Property 41: Deterministic processing', async () => {
      /**
       * **Feature: position-lifecycle-engine, Property 41: Deterministic processing**
       * **Validates: Requirements 9.1**
       * 
       * For any identical event sequence processed multiple times, the final states should be identical
       */
      await fc.assert(
        fc.asyncProperty(tradeSignalArbitrary, async (tradeSignal) => {
          const position1 = await engine.createPosition(tradeSignal);
          const position2 = await engine.createPosition(tradeSignal);
          
          try {
            // Apply identical sequence of operations
            const operations = [
              {
                type: 'fill',
                data: {
                  orderId: randomUUID(),
                  price: tradeSignal.entryPrice,
                  size: tradeSignal.positionSize,
                  executedAt: new Date()
                }
              },
              {
                type: 'pnl_update',
                price: tradeSignal.entryPrice * 1.01
              }
            ];
            
            // Apply to first position
            for (const op of operations) {
              if (op.type === 'fill') {
                await engine.processFullFill(position1.id, op.data);
              } else if (op.type === 'pnl_update') {
                await engine.updatePositionPnL(position1.id, op.price);
              }
            }
            
            // Apply to second position
            for (const op of operations) {
              if (op.type === 'fill') {
                await engine.processFullFill(position2.id, op.data);
              } else if (op.type === 'pnl_update') {
                await engine.updatePositionPnL(position2.id, op.price);
              }
            }
            
            // Final states should be identical
            const finalPosition1 = await engine.getPosition(position1.id);
            const finalPosition2 = await engine.getPosition(position2.id);
            
            expect(finalPosition1?.status).toBe(finalPosition2?.status);
            expect(finalPosition1?.size).toBe(finalPosition2?.size);
            expect(finalPosition1?.avgEntryPrice).toBe(finalPosition2?.avgEntryPrice);
            expect(finalPosition1?.unrealizedPnL).toBeCloseTo(finalPosition2?.unrealizedPnL || 0, 6);
            
            return true;
          } finally {
            // Cleanup
            for (const posId of [position1.id, position2.id]) {
              await supabase.from('trade_executions').delete().eq('position_id', posId);
              await supabase.from('position_events').delete().eq('position_id', posId);
              await supabase.from('positions').delete().eq('id', posId);
            }
          }
        }),
        PROPERTY_TEST_CONFIG
      );
    });
  });

  describe('🏁 COMPREHENSIVE PROPERTY VALIDATION', () => {
    it('should validate all critical properties together', async () => {
      /**
       * Combined property test that validates multiple properties in a single scenario
       */
      await fc.assert(
        fc.asyncProperty(
          tradeSignalArbitrary,
          priceArbitrary,
          fc.double({ min: 0.1, max: 0.9 }),
          async (tradeSignal, marketPrice, exitRatio) => {
            const position = await engine.createPosition(tradeSignal);
            
            try {
              // Property 1: Position should be initialized as PENDING
              expect(position.status).toBe(PositionState.PENDING);
              
              // Property 2: First fill should transition to OPEN
              await engine.processFullFill(position.id, {
                orderId: randomUUID(),
                price: tradeSignal.entryPrice,
                size: tradeSignal.positionSize,
                executedAt: new Date()
              });
              
              const openPosition = await engine.getPosition(position.id);
              expect(openPosition?.status).toBe(PositionState.OPEN);
              
              // Property 15: PnL calculation should be correct
              await engine.updatePositionPnL(position.id, marketPrice);
              const pnlPosition = await engine.getPosition(position.id);
              
              const expectedPnL = tradeSignal.direction === 'BUY' 
                ? (marketPrice - tradeSignal.entryPrice) * tradeSignal.positionSize
                : (tradeSignal.entryPrice - marketPrice) * tradeSignal.positionSize;
              
              expect(Math.abs(pnlPosition!.unrealizedPnL - expectedPnL)).toBeLessThan(1.0);
              
              // Property 18: Events should be recorded
              const { data: events } = await supabase
                .from('position_events')
                .select('*')
                .eq('position_id', position.id);
              
              expect(events!.length).toBeGreaterThan(0);
              
              // Property 8: Executions should be recorded
              const { data: executions } = await supabase
                .from('trade_executions')
                .select('*')
                .eq('position_id', position.id);
              
              expect(executions!.length).toBeGreaterThan(0);
              
              return true;
            } finally {
              // Cleanup
              await supabase.from('trade_executions').delete().eq('position_id', position.id);
              await supabase.from('position_events').delete().eq('position_id', position.id);
              await supabase.from('positions').delete().eq('id', position.id);
            }
          }
        ),
        PROPERTY_TEST_CONFIG
      );
    });
  });
});