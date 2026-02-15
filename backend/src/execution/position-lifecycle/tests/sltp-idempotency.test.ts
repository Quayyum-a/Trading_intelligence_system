/**
 * SL/TP Monitor Service - Idempotency Tests
 * 
 * Tests for Task 5: Enhance SL/TP Monitor Service with idempotency
 * Requirements: 1.1.1, 1.1.2, 1.1.3, 1.3.1, 1.3.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { SLTPMonitorService } from '../services/sl-tp-monitor.service';
import { PositionState, PositionEventType } from '../types/position-lifecycle.types';

config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Skip tests if environment variables are not set
const describeOrSkip = supabaseUrl && supabaseKey ? describe : describe.skip;

describeOrSkip('SL/TP Monitor Service - Idempotency', () => {
  let supabase: ReturnType<typeof createClient>;
  let sltpMonitor: SLTPMonitorService;
  let mockPositionRepository: any;
  let mockExecutionTracking: any;
  let mockRiskLedger: any;
  let mockEventService: any;
  let testPositionId: string;

  beforeEach(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    testPositionId = `test-position-${Date.now()}`;

    // Create mock repositories and services
    mockPositionRepository = {
      findById: vi.fn(),
      findByStatus: vi.fn(),
      update: vi.fn()
    };

    mockExecutionTracking = {
      triggerStopLoss: vi.fn(),
      triggerTakeProfit: vi.fn()
    };

    mockRiskLedger = {
      updateAccountBalance: vi.fn()
    };

    mockEventService = {
      emitEvent: vi.fn()
    };

    // Initialize SL/TP monitor service
    sltpMonitor = new SLTPMonitorService(
      mockPositionRepository,
      mockExecutionTracking,
      mockRiskLedger,
      mockEventService,
      supabase
    );
  });

  afterEach(async () => {
    // Clean up test data
    await supabase
      .from('position_events')
      .delete()
      .like('idempotency_key', `close_${testPositionId}%`);
    
    sltpMonitor.shutdown();
  });

  describe('Task 5.1: Idempotency Key Generation and Checking', () => {
    it('should generate idempotency key in correct format', () => {
      const positionId = 'test-position-123';
      const timestamp = new Date('2024-01-01T12:00:00Z');
      
      // Access private method via type assertion for testing
      const service = sltpMonitor as any;
      const key = service.generateIdempotencyKey(positionId, timestamp);
      
      expect(key).toBe(`close_${positionId}_${timestamp.getTime()}`);
      expect(key).toMatch(/^close_test-position-123_\d+$/);
    });

    it('should detect duplicate idempotency keys', async () => {
      const idempotencyKey = `close_${testPositionId}_${Date.now()}`;
      
      // Insert a test event with the idempotency key
      await supabase
        .from('position_events')
        .insert({
          position_id: testPositionId,
          event_type: 'STOP_LOSS_TRIGGERED',
          payload: { test: true },
          idempotency_key: idempotencyKey
        });

      // Check if key exists
      const service = sltpMonitor as any;
      const exists = await service.checkIdempotencyKey(idempotencyKey);
      
      expect(exists).toBe(true);
    });

    it('should return false for non-existent idempotency keys', async () => {
      const idempotencyKey = `close_nonexistent_${Date.now()}`;
      
      const service = sltpMonitor as any;
      const exists = await service.checkIdempotencyKey(idempotencyKey);
      
      expect(exists).toBe(false);
    });
  });

  describe('Task 5.3: Automatic Position Closure', () => {
    it('should trigger stop loss when price breaches SL level (BUY position)', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        takeProfit: 2020,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerStopLoss.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      // Start monitoring
      await sltpMonitor.startMonitoring(testPositionId);

      // Update price to trigger stop loss
      const triggers = await sltpMonitor.updatePrice({
        symbol: 'XAUUSD',
        price: 1989, // Below stop loss
        timestamp: new Date()
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].triggerType).toBe('STOP_LOSS');
      expect(triggers[0].positionId).toBe(testPositionId);
    });

    it('should trigger take profit when price breaches TP level (BUY position)', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        takeProfit: 2020,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: 20
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerTakeProfit.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      // Start monitoring
      await sltpMonitor.startMonitoring(testPositionId);

      // Update price to trigger take profit
      const triggers = await sltpMonitor.updatePrice({
        symbol: 'XAUUSD',
        price: 2021, // Above take profit
        timestamp: new Date()
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].triggerType).toBe('TAKE_PROFIT');
      expect(triggers[0].positionId).toBe(testPositionId);
    });

    it('should trigger stop loss when price breaches SL level (SELL position)', async () => {
      const position = {
        id: testPositionId,
        side: 'SELL',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 2010,
        takeProfit: 1980,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerStopLoss.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      // Start monitoring
      await sltpMonitor.startMonitoring(testPositionId);

      // Update price to trigger stop loss
      const triggers = await sltpMonitor.updatePrice({
        symbol: 'XAUUSD',
        price: 2011, // Above stop loss for SELL
        timestamp: new Date()
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].triggerType).toBe('STOP_LOSS');
      expect(triggers[0].positionId).toBe(testPositionId);
    });
  });

  describe('Task 5.5: Event Creation for SL/TP Triggers', () => {
    it('should create STOP_LOSS_TRIGGERED event with idempotency key', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerStopLoss.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      // Start monitoring
      await sltpMonitor.startMonitoring(testPositionId);

      // Update price to trigger stop loss
      await sltpMonitor.updatePrice({
        symbol: 'XAUUSD',
        price: 1989,
        timestamp: new Date()
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify event was emitted with idempotency key
      expect(mockEventService.emitEvent).toHaveBeenCalledWith(
        testPositionId,
        PositionEventType.STOP_LOSS_TRIGGERED,
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^close_/)
        })
      );
    });

    it('should create TAKE_PROFIT_TRIGGERED event with idempotency key', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        takeProfit: 2020,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: 20
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerTakeProfit.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      // Start monitoring
      await sltpMonitor.startMonitoring(testPositionId);

      // Update price to trigger take profit
      await sltpMonitor.updatePrice({
        symbol: 'XAUUSD',
        price: 2021,
        timestamp: new Date()
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify event was emitted with idempotency key
      expect(mockEventService.emitEvent).toHaveBeenCalledWith(
        testPositionId,
        PositionEventType.TAKE_PROFIT_TRIGGERED,
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^close_/)
        })
      );
    });
  });

  describe('Idempotency - Duplicate Request Handling', () => {
    it('should return success for duplicate closure requests without executing twice', async () => {
      const timestamp = new Date();
      const idempotencyKey = `close_${testPositionId}_${timestamp.getTime()}`;
      
      // Insert event to simulate first closure
      await supabase
        .from('position_events')
        .insert({
          position_id: testPositionId,
          event_type: 'STOP_LOSS_TRIGGERED',
          payload: { test: true },
          idempotency_key: idempotencyKey
        });

      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);

      // Try to execute trigger with same timestamp (duplicate request)
      const service = sltpMonitor as any;
      const trigger = {
        positionId: testPositionId,
        triggerType: 'STOP_LOSS',
        triggerPrice: 1990,
        marketPrice: 1989,
        timestamp
      };

      // Should not throw and should not call execution tracking
      await service.executeTrigger(trigger);

      // Verify execution tracking was NOT called (idempotent)
      expect(mockExecutionTracking.triggerStopLoss).not.toHaveBeenCalled();
    });
  });

  describe('Integration with TransactionCoordinator', () => {
    it('should execute closure within a transaction', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerStopLoss.mockResolvedValue(undefined);
      mockRiskLedger.updateAccountBalance.mockResolvedValue(undefined);

      const service = sltpMonitor as any;
      const trigger = {
        positionId: testPositionId,
        triggerType: 'STOP_LOSS',
        triggerPrice: 1990,
        marketPrice: 1989,
        timestamp: new Date()
      };

      // Execute trigger
      await service.executeTrigger(trigger);

      // Verify all operations were called
      expect(mockEventService.emitEvent).toHaveBeenCalled();
      expect(mockExecutionTracking.triggerStopLoss).toHaveBeenCalled();
      expect(mockRiskLedger.updateAccountBalance).toHaveBeenCalled();
    });

    it('should rollback on error during closure', async () => {
      const position = {
        id: testPositionId,
        side: 'BUY',
        size: 1.0,
        avgEntryPrice: 2000,
        stopLoss: 1990,
        status: PositionState.OPEN,
        pair: 'XAUUSD',
        accountId: 'default',
        realizedPnL: -10
      };

      mockPositionRepository.findById.mockResolvedValue(position);
      mockExecutionTracking.triggerStopLoss.mockRejectedValue(new Error('Execution failed'));

      const service = sltpMonitor as any;
      const trigger = {
        positionId: testPositionId,
        triggerType: 'STOP_LOSS',
        triggerPrice: 1990,
        marketPrice: 1989,
        timestamp: new Date()
      };

      // Should throw error
      await expect(service.executeTrigger(trigger)).rejects.toThrow('Execution failed');

      // Verify error event was emitted
      expect(mockEventService.emitEvent).toHaveBeenCalledWith(
        testPositionId,
        PositionEventType.POSITION_UPDATED,
        expect.objectContaining({
          error: expect.stringContaining('Failed to execute')
        })
      );
    });
  });
});
