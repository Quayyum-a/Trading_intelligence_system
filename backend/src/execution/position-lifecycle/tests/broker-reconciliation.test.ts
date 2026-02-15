/**
 * Broker Reconciliation Service Tests
 * 
 * Tests the broker reconciliation service to ensure it correctly:
 * - Detects discrepancies between broker and DB state
 * - Syncs DB to CLOSED when broker shows CLOSED
 * - Logs all discrepancies with full context
 * - Runs periodic reconciliation every 10 seconds
 * 
 * Requirements: 1.2.1, 1.2.2, 1.2.3, 1.2.4, 1.2.5, 1.2.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { BrokerReconciliationService } from '../services/broker-reconciliation.service';
import { BrokerAdapter } from '../../../execution/interfaces/broker-adapter.interface';
import { BrokerPosition } from '../../../execution/types/execution.types';
import { IPositionEventService } from '../interfaces/position-event.interface';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
} as any;

// Mock broker adapter
const mockBrokerAdapter: BrokerAdapter = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  validateAccount: vi.fn(),
  placeOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrderStatus: vi.fn(),
  getOpenPositions: vi.fn(),
  closePosition: vi.fn(),
  subscribeToExecutions: vi.fn(),
};

// Mock event service
const mockEventService: IPositionEventService = {
  createEvent: vi.fn(),
  getEventsByPosition: vi.fn(),
  getEventsByType: vi.fn(),
  getLatestEvent: vi.fn(),
} as any;

describe('BrokerReconciliationService', () => {
  let service: BrokerReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrokerReconciliationService(
      mockSupabase,
      mockBrokerAdapter,
      mockEventService
    );
  });

  afterEach(() => {
    service.stopReconciliation();
  });

  describe('reconcile()', () => {
    it('should detect no discrepancies when broker and DB match', async () => {
      // Setup: DB has 2 open positions
      const dbPositions = [
        {
          id: 'pos-1',
          execution_trade_id: 'trade-1',
          pair: 'XAUUSD',
          side: 'BUY',
          size: 1.0,
          status: 'OPEN',
          avg_entry_price: 2000,
        },
        {
          id: 'pos-2',
          execution_trade_id: 'trade-2',
          pair: 'EURUSD',
          side: 'SELL',
          size: 0.5,
          status: 'OPEN',
          avg_entry_price: 1.1,
        },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: dbPositions,
            error: null,
          }),
        }),
      });

      // Broker has matching positions
      const brokerPositions: BrokerPosition[] = [
        {
          positionId: 'pos-1',
          symbol: 'XAUUSD',
          side: 'BUY',
          size: 1.0,
          entryPrice: 2000,
          currentPrice: 2010,
          unrealizedPnL: 10,
          marginUsed: 200,
        },
        {
          positionId: 'pos-2',
          symbol: 'EURUSD',
          side: 'SELL',
          size: 0.5,
          entryPrice: 1.1,
          currentPrice: 1.09,
          unrealizedPnL: 5,
          marginUsed: 55,
        },
      ];

      vi.mocked(mockBrokerAdapter.getOpenPositions).mockResolvedValue(brokerPositions);

      // Execute
      const result = await service.reconcile();

      // Verify
      expect(result.positionsChecked).toBe(2);
      expect(result.discrepanciesFound).toBe(0);
      expect(result.discrepancies).toHaveLength(0);
      expect(result.actionsTaken).toHaveLength(0);
    });

    it('should detect discrepancy when broker CLOSED but DB OPEN', async () => {
      // Setup: DB has 1 open position
      const dbPositions = [
        {
          id: 'pos-1',
          execution_trade_id: 'trade-1',
          pair: 'XAUUSD',
          side: 'BUY',
          size: 1.0,
          status: 'OPEN',
          avg_entry_price: 2000,
        },
      ];

      // Mock transaction coordinator and DB updates
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'positions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: dbPositions,
                error: null,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'account_balances') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { balance: 10000, margin_used: 2000 },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'account_balance_events') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'reconciliation_log') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      });

      // Broker has no positions (closed)
      vi.mocked(mockBrokerAdapter.getOpenPositions).mockResolvedValue([]);

      vi.mocked(mockEventService.createEvent).mockResolvedValue(undefined);

      // Mock RPC for transaction coordinator
      mockSupabase.rpc.mockResolvedValue({ error: null });

      // Execute
      const result = await service.reconcile();

      // Verify
      expect(result.positionsChecked).toBe(1);
      expect(result.discrepanciesFound).toBe(1);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0]).toMatchObject({
        positionId: 'pos-1',
        brokerStatus: 'CLOSED',
        dbStatus: 'OPEN',
        action: 'SYNC_DB',
      });
      expect(result.actionsTaken).toHaveLength(1);
    });

    it('should detect discrepancy when broker OPEN but DB has no matching position', async () => {
      // Setup: DB has no open positions
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      });

      // Broker has 1 open position
      const brokerPositions: BrokerPosition[] = [
        {
          positionId: 'broker-pos-1',
          symbol: 'XAUUSD',
          side: 'BUY',
          size: 1.0,
          entryPrice: 2000,
          currentPrice: 2010,
          unrealizedPnL: 10,
          marginUsed: 200,
        },
      ];

      vi.mocked(mockBrokerAdapter.getOpenPositions).mockResolvedValue(brokerPositions);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reconciliation_log') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      });

      // Execute
      const result = await service.reconcile();

      // Verify
      expect(result.positionsChecked).toBe(0);
      expect(result.discrepanciesFound).toBe(1);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0]).toMatchObject({
        symbol: 'XAUUSD',
        brokerStatus: 'OPEN',
        dbStatus: 'CLOSED_OR_MISSING',
        action: 'ALERT_ONLY',
      });
    });
  });

  describe('startReconciliation() and stopReconciliation()', () => {
    it('should start periodic reconciliation', async () => {
      // Mock reconcile to avoid actual execution
      const reconcileSpy = vi.spyOn(service, 'reconcile').mockResolvedValue({
        timestamp: new Date(),
        positionsChecked: 0,
        discrepanciesFound: 0,
        discrepancies: [],
        actionsTaken: [],
      });

      // Start reconciliation
      service.startReconciliation();

      // Wait a bit to ensure it runs
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify reconcile was called at least once (initial run)
      expect(reconcileSpy).toHaveBeenCalled();

      // Stop reconciliation
      service.stopReconciliation();
    });

    it('should not start multiple reconciliation loops', () => {
      const reconcileSpy = vi.spyOn(service, 'reconcile').mockResolvedValue({
        timestamp: new Date(),
        positionsChecked: 0,
        discrepanciesFound: 0,
        discrepancies: [],
        actionsTaken: [],
      });

      // Start twice
      service.startReconciliation();
      service.startReconciliation();

      // Should only have one interval running
      service.stopReconciliation();
    });
  });

  describe('getStatistics()', () => {
    it('should return reconciliation statistics', () => {
      const stats = service.getStatistics();

      expect(stats).toHaveProperty('totalReconciliations');
      expect(stats).toHaveProperty('totalDiscrepancies');
      expect(stats).toHaveProperty('lastReconciliation');
      expect(stats).toHaveProperty('averageCheckTime');
      expect(stats.totalReconciliations).toBe(0);
      expect(stats.totalDiscrepancies).toBe(0);
    });

    it('should update statistics after reconciliation', async () => {
      // Setup
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'positions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        if (table === 'reconciliation_log') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      });

      vi.mocked(mockBrokerAdapter.getOpenPositions).mockResolvedValue([]);

      // Execute
      await service.reconcile();

      // Verify
      const stats = service.getStatistics();
      expect(stats.totalReconciliations).toBe(1);
      expect(stats.lastReconciliation).not.toBeNull();
      expect(stats.averageCheckTime).toBeGreaterThanOrEqual(0);
    });
  });
});
