/**
 * Basic Position Lifecycle Engine Tests
 * Focused on core functionality with minimal complexity
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PositionLifecycleEngine, PositionLifecycleEngineConfig } from '../position-lifecycle-engine';
import { PositionState, ExecutionType } from '../types/position-lifecycle.types';
import { TradeSignal } from '../../types/execution.types';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('🔧 POSITION LIFECYCLE ENGINE - BASIC TESTS', () => {
  let engine: PositionLifecycleEngine;
  let supabase: ReturnType<typeof createClient>;
  let testAccountId: string;
  let testPositionIds: string[] = [];

  beforeAll(async () => {
    console.log('🧪 Setting up basic position lifecycle tests...');
    
    const config: PositionLifecycleEngineConfig = {
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      paperTradingConfig: {
        slippageEnabled: false, // Disable for faster testing
        maxSlippageBps: 0,
        latencyMs: 0,
        rejectionRate: 0
      },
      maxLeverage: 100,
      marginCallLevel: 0.5,
      liquidationLevel: 0.2,
      commissionRate: 0.0001
    };

    engine = new PositionLifecycleEngine(config);
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
    
    // Set up minimal test database records
    await setupMinimalTestDatabase();
    
    // Initialize the engine
    console.log('Initializing engine...');
    await engine.initialize();

    // Create test account
    testAccountId = randomUUID();
    await supabase.from('account_balances').insert({
      id: testAccountId,
      equity: 10000,
      balance: 10000,
      marginUsed: 0,
      freeMargin: 10000,
      leverage: 100,
      isPaper: true
    });
    
    console.log('✅ Basic test setup completed');
  }, 30000);

  async function setupMinimalTestDatabase() {
    // Create minimal test records
    const testCandleId = '00000000-0000-0000-0000-000000000001';
    await supabase.from('candles').upsert({
      id: testCandleId,
      pair: 'XAUUSD',
      timeframe: 'M15',
      timestamp: '2024-01-01T00:00:00Z',
      open: 2000,
      high: 2005,
      low: 1995,
      close: 2002,
      volume: 100
    });

    const testDecisionId = '98ba1dca-95c7-4fcc-a6ba-3c8c8011270e';
    await supabase.from('strategy_decisions').upsert({
      id: testDecisionId,
      candle_id: testCandleId,
      pair: 'XAUUSD',
      timeframe: 'M15',
      decision: 'BUY',
      regime: 'TRENDING',
      confidence_score: 0.8,
      reason: { test: true },
      trading_window_start: '09:00',
      trading_window_end: '17:00',
      candle_timestamp: '2024-01-01T00:00:00Z'
    });
  }

  async function createSimpleTradeSignal(): Promise<TradeSignal> {
    const signalId = randomUUID();
    const tradeSignal: TradeSignal = {
      id: signalId,
      direction: 'BUY',
      entryPrice: 2000.00,
      positionSize: 0.1,
      leverage: 100,
      marginRequired: 200.00,
      stopLoss: 1995.00,
      takeProfit: 2010.00
    };

    // Create minimal database records
    await supabase.from('trade_signals').insert({
      id: signalId,
      strategy_decision_id: '98ba1dca-95c7-4fcc-a6ba-3c8c8011270e',
      direction: tradeSignal.direction,
      entry_price: tradeSignal.entryPrice,
      stop_loss: tradeSignal.stopLoss,
      take_profit: tradeSignal.takeProfit,
      rr_ratio: 2.0,
      risk_percent: 0.01,
      leverage: tradeSignal.leverage,
      position_size: tradeSignal.positionSize,
      margin_required: tradeSignal.marginRequired,
      candle_timestamp: new Date().toISOString()
    });

    await supabase.from('execution_trades').insert({
      id: signalId,
      trade_signal_id: signalId,
      pair: 'XAUUSD',
      timeframe: 'M15',
      side: tradeSignal.direction,
      status: 'NEW',
      entry_price: tradeSignal.entryPrice,
      stop_loss: tradeSignal.stopLoss,
      take_profit: tradeSignal.takeProfit,
      position_size: tradeSignal.positionSize,
      risk_percent: 0.01,
      leverage: tradeSignal.leverage,
      rr: 2.0,
      execution_mode: 'PAPER'
    });

    return tradeSignal;
  }

  afterAll(async () => {
    console.log('🧹 Cleaning up basic tests...');
    await engine.shutdown();
    
    // Clean up test data
    if (testPositionIds.length > 0) {
      await supabase.from('positions').delete().in('id', testPositionIds);
    }
    await supabase.from('account_balances').delete().eq('id', testAccountId);
  });

  beforeEach(() => {
    testPositionIds = [];
  });

  afterEach(async () => {
    // Clean up positions created in each test
    if (testPositionIds.length > 0) {
      await supabase.from('position_events').delete().in('position_id', testPositionIds);
      await supabase.from('trade_executions').delete().in('position_id', testPositionIds);
      await supabase.from('positions').delete().in('id', testPositionIds);
      testPositionIds = [];
    }
  });

  describe('🏗️ BASIC POSITION OPERATIONS', () => {
    it('should create a position successfully', async () => {
      console.log('🧪 Testing position creation...');
      
      const tradeSignal = await createSimpleTradeSignal();
      const position = await engine.createPosition(tradeSignal);
      testPositionIds.push(position.id);

      expect(position.status).toBe(PositionState.PENDING);
      expect(position.size).toBe(0);
      expect(position.avgEntryPrice).toBe(2000.00);
      
      console.log('✅ Position created successfully');
    }, 8000);

    it('should process a full fill and transition to OPEN', async () => {
      console.log('🧪 Testing full fill processing...');
      
      const tradeSignal = await createSimpleTradeSignal();
      const position = await engine.createPosition(tradeSignal);
      testPositionIds.push(position.id);

      // Process full fill
      await engine.processFullFill(position.id, {
        orderId: randomUUID(),
        price: 2000.00,
        size: 0.1,
        executedAt: new Date()
      });

      const updatedPosition = await engine.getPosition(position.id);
      expect(updatedPosition?.status).toBe(PositionState.OPEN);
      expect(updatedPosition?.size).toBe(0.1);
      
      console.log('✅ Full fill processed successfully');
    }, 8000);

    it('should update position PnL correctly', async () => {
      console.log('🧪 Testing PnL updates...');
      
      const tradeSignal = await createSimpleTradeSignal();
      const position = await engine.createPosition(tradeSignal);
      testPositionIds.push(position.id);

      // Open position
      await engine.processFullFill(position.id, {
        orderId: randomUUID(),
        price: 2000.00,
        size: 0.1,
        executedAt: new Date()
      });

      // Update PnL with favorable price
      await engine.updatePositionPnL(position.id, 2005.00);
      
      const updatedPosition = await engine.getPosition(position.id);
      expect(updatedPosition?.unrealizedPnL).toBeGreaterThan(0);
      
      console.log('✅ PnL updated successfully');
    }, 8000);

    it('should get position metrics', async () => {
      console.log('🧪 Testing position metrics...');
      
      const tradeSignal = await createSimpleTradeSignal();
      const position = await engine.createPosition(tradeSignal);
      testPositionIds.push(position.id);

      // Open position
      await engine.processFullFill(position.id, {
        orderId: randomUUID(),
        price: 2000.00,
        size: 0.1,
        executedAt: new Date()
      });

      const metrics = await engine.getPositionMetrics(position.id);
      expect(metrics.positionId).toBe(position.id);
      expect(typeof metrics.unrealizedPnL).toBe('number');
      
      console.log('✅ Position metrics retrieved successfully');
    }, 8000);
  });

  describe('🔍 SYSTEM VALIDATION', () => {
    it('should provide engine statistics', async () => {
      console.log('🧪 Testing engine statistics...');
      
      const stats = await engine.getEngineStatistics();
      
      expect(typeof stats.totalPositions).toBe('number');
      expect(typeof stats.openPositions).toBe('number');
      expect(['HEALTHY', 'WARNING', 'CRITICAL']).toContain(stats.systemHealth);
      
      console.log('✅ Engine statistics retrieved successfully');
    }, 5000);

    it('should handle invalid operations gracefully', async () => {
      console.log('🧪 Testing error handling...');
      
      const invalidPositionId = 'invalid-position-id';
      
      await expect(engine.updatePositionPnL(invalidPositionId, 2000.00))
        .rejects.toThrow();

      await expect(engine.getPosition(invalidPositionId))
        .resolves.toBeNull();
      
      console.log('✅ Error handling working correctly');
    }, 5000);
  });

  describe('🎯 FINAL VALIDATION', () => {
    it('should pass basic end-to-end validation', async () => {
      console.log('🧪 Running end-to-end validation...');
      
      // Create and process a complete position lifecycle
      const tradeSignal = await createSimpleTradeSignal();
      const position = await engine.createPosition(tradeSignal);
      testPositionIds.push(position.id);

      // Open position
      await engine.processFullFill(position.id, {
        orderId: randomUUID(),
        price: 2000.00,
        size: 0.1,
        executedAt: new Date()
      });

      // Update PnL
      await engine.updatePositionPnL(position.id, 2005.00);
      
      // Get final state
      const finalPosition = await engine.getPosition(position.id);
      const metrics = await engine.getPositionMetrics(position.id);
      const stats = await engine.getEngineStatistics();

      // Validate everything is working
      expect(finalPosition?.status).toBe(PositionState.OPEN);
      expect(finalPosition?.unrealizedPnL).toBeGreaterThan(0);
      expect(metrics.positionId).toBe(position.id);
      expect(stats.openPositions).toBeGreaterThan(0);
      
      console.log('🎉 END-TO-END VALIDATION PASSED');
      console.log('✅ Position lifecycle working correctly');
      console.log('✅ PnL calculations functional');
      console.log('✅ System metrics available');
      console.log('🚀 BASIC POSITION LIFECYCLE ENGINE IS FUNCTIONAL');
    }, 15000);
  });
});