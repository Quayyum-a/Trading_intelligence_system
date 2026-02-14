/**
 * Stop Loss Optimization Tests
 * 
 * Tests the optimized stop loss trigger processing with:
 * - Real-time market data monitoring for stop loss
 * - Priority queue for stop loss execution
 * - Optimized trigger response time and execution latency
 * 
 * Requirements: 2.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StopLossPriorityQueueService } from '../services/stop-loss-priority-queue.service';
import { SLTPMonitorService } from '../services/sl-tp-monitor.service';
import { PositionState } from '../types/position-lifecycle.types';

describe('Stop Loss Optimization', () => {
  let priorityQueue: StopLossPriorityQueueService;
  let sltpMonitor: SLTPMonitorService;
  let mockPositionRepository: any;
  let mockExecutionTracking: any;
  let mockRiskLedger: any;
  let mockEventService: any;

  beforeEach(() => {
    // Initialize priority queue
    priorityQueue = new StopLossPriorityQueueService(100, 1000, 5000);

    // Mock services
    mockPositionRepository = {
      findById: vi.fn(),
      findByStatus: vi.fn(),
      update: vi.fn(),
    };

    mockExecutionTracking = {
      triggerStopLoss: vi.fn(),
      triggerTakeProfit: vi.fn(),
    };

    mockRiskLedger = {
      updateAccountBalance: vi.fn(),
    };

    mockEventService = {
      emitEvent: vi.fn(),
    };

    // Initialize SL/TP monitor
    sltpMonitor = new SLTPMonitorService(
      mockPositionRepository,
      mockExecutionTracking,
      mockRiskLedger,
      mockEventService
    );
  });

  afterEach(() => {
    priorityQueue.clear();
    sltpMonitor.shutdown();
  });

  describe('StopLossPriorityQueueService', () => {
    describe('Priority Queue Management', () => {
      it('should add triggers to queue with correct priority', () => {
        const triggerId = priorityQueue.addTrigger({
          positionId: 'pos-123',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: {
            positionSize: 100000,
            riskLevel: 'HIGH'
          }
        });

        expect(triggerId).toBeDefined();
        
        const stats = priorityQueue.getQueueStats();
        expect(stats.pendingTriggers).toBe(1);
        expect(stats.totalTriggers).toBe(1);
      });

      it('should prioritize triggers correctly', () => {
        // Add low priority trigger
        priorityQueue.addTrigger({
          positionId: 'pos-1',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2050, // Far from trigger
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 1000, riskLevel: 'LOW' }
        });

        // Add high priority trigger
        priorityQueue.addTrigger({
          positionId: 'pos-2',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001, // Very close to trigger
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 100000, riskLevel: 'HIGH' }
        });

        const stats = priorityQueue.getQueueStats();
        expect(stats.pendingTriggers).toBe(2);
        expect(stats.highPriorityCount).toBeGreaterThan(0);
      });

      it('should update priorities when market price changes', () => {
        const triggerId = priorityQueue.addTrigger({
          positionId: 'pos-123',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2050,
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 50000 }
        });

        // Update market price to be very close to trigger
        priorityQueue.updateMarketPrice('EURUSD', 1.2001);

        const stats = priorityQueue.getQueueStats();
        expect(stats.highPriorityCount).toBeGreaterThan(0);
      });

      it('should handle queue capacity limits', () => {
        const smallQueue = new StopLossPriorityQueueService(100, 2, 5000);

        // Add triggers up to capacity
        smallQueue.addTrigger({
          positionId: 'pos-1',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        smallQueue.addTrigger({
          positionId: 'pos-2',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        // Add one more - should remove lowest priority
        smallQueue.addTrigger({
          positionId: 'pos-3',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 200000, riskLevel: 'HIGH' } // High priority
        });

        const stats = smallQueue.getQueueStats();
        expect(stats.pendingTriggers).toBe(2); // Should still be at capacity
        
        smallQueue.clear();
      });
    });

    describe('Trigger Processing', () => {
      it('should process triggers in priority order', async () => {
        const executionOrder: string[] = [];

        // Add multiple triggers with different priorities
        priorityQueue.addTrigger({
          positionId: 'pos-low',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2050,
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 1000, riskLevel: 'LOW' }
        });

        priorityQueue.addTrigger({
          positionId: 'pos-high',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date(),
          metadata: { positionSize: 100000, riskLevel: 'HIGH' }
        });

        // Process triggers
        const result1 = await priorityQueue.processNextTrigger(async (trigger) => {
          executionOrder.push(trigger.positionId);
        });

        const result2 = await priorityQueue.processNextTrigger(async (trigger) => {
          executionOrder.push(trigger.positionId);
        });

        expect(result1?.success).toBe(true);
        expect(result2?.success).toBe(true);
        expect(executionOrder[0]).toBe('pos-high'); // High priority first
        expect(executionOrder[1]).toBe('pos-low'); // Low priority second
      });

      it('should handle processing timeouts', async () => {
        const shortTimeoutQueue = new StopLossPriorityQueueService(100, 1000, 100); // 100ms timeout

        shortTimeoutQueue.addTrigger({
          positionId: 'pos-timeout',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        // Process with slow callback
        const result = await shortTimeoutQueue.processNextTrigger(async () => {
          await new Promise(resolve => setTimeout(resolve, 200)); // Longer than timeout
        });

        expect(result?.success).toBe(false);
        expect(result?.error).toContain('timeout');
        
        shortTimeoutQueue.clear();
      });

      it('should track processing statistics', async () => {
        priorityQueue.addTrigger({
          positionId: 'pos-stats',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        await priorityQueue.processNextTrigger(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
        });

        const stats = priorityQueue.getQueueStats();
        expect(stats.processedTriggers).toBe(1);
        expect(stats.averageProcessingTimeMs).toBeGreaterThan(0);
      });
    });

    describe('Queue Optimization', () => {
      it('should remove stale triggers', () => {
        // Add trigger with old timestamp
        const oldDate = new Date(Date.now() - 120000); // 2 minutes ago
        
        priorityQueue.addTrigger({
          positionId: 'pos-stale',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: oldDate // This is what gets checked for staleness
        });

        // Add fresh trigger
        priorityQueue.addTrigger({
          positionId: 'pos-fresh',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        const initialStats = priorityQueue.getQueueStats();
        expect(initialStats.pendingTriggers).toBe(2);

        // Optimize queue (remove triggers older than 1 minute)
        const removedCount = priorityQueue.optimizeQueue(60000);
        
        const finalStats = priorityQueue.getQueueStats();
        expect(removedCount).toBe(1);
        expect(finalStats.pendingTriggers).toBe(1);
      });

      it('should calculate urgency levels correctly', () => {
        // Critical urgency - very close to trigger
        priorityQueue.addTrigger({
          positionId: 'pos-critical',
          symbol: 'EURUSD',
          triggerPrice: 1.20000,
          currentPrice: 1.20001, // 0.0008% away
          side: 'BUY',
          triggeredAt: new Date()
        });

        // Low urgency - far from trigger
        priorityQueue.addTrigger({
          positionId: 'pos-low',
          symbol: 'EURUSD',
          triggerPrice: 1.20000,
          currentPrice: 1.21000, // 0.83% away
          side: 'BUY',
          triggeredAt: new Date()
        });

        const stats = priorityQueue.getQueueStats();
        expect(stats.criticalCount).toBe(1);
      });
    });

    describe('Position Management', () => {
      it('should cancel triggers for specific positions', () => {
        // Add triggers for different positions
        priorityQueue.addTrigger({
          positionId: 'pos-1',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        priorityQueue.addTrigger({
          positionId: 'pos-2',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        priorityQueue.addTrigger({
          positionId: 'pos-1', // Same position as first
          symbol: 'GBPUSD',
          triggerPrice: 1.3000,
          currentPrice: 1.3001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        const initialStats = priorityQueue.getQueueStats();
        expect(initialStats.pendingTriggers).toBe(3);

        // Cancel triggers for pos-1
        const canceledCount = priorityQueue.cancelTriggersForPosition('pos-1');
        
        expect(canceledCount).toBe(2);
        
        const finalStats = priorityQueue.getQueueStats();
        expect(finalStats.pendingTriggers).toBe(1);
      });

      it('should get pending triggers for position', () => {
        priorityQueue.addTrigger({
          positionId: 'pos-test',
          symbol: 'EURUSD',
          triggerPrice: 1.2000,
          currentPrice: 1.2001,
          side: 'BUY',
          triggeredAt: new Date()
        });

        const pendingTriggers = priorityQueue.getPendingTriggers('pos-test');
        expect(pendingTriggers).toHaveLength(1);
        expect(pendingTriggers[0].positionId).toBe('pos-test');
      });
    });
  });

  describe('SLTPMonitorService Integration', () => {
    it('should integrate with priority queue for trigger processing', async () => {
      // Mock position
      const mockPosition = {
        id: 'pos-123',
        status: PositionState.OPEN,
        side: 'BUY',
        size: 100000,
        avgEntryPrice: 1.2000,
        stopLoss: 1.1950,
        takeProfit: 1.2100,
        pair: 'EURUSD'
      };

      mockPositionRepository.findById.mockResolvedValue(mockPosition);
      mockPositionRepository.findByStatus.mockResolvedValue([mockPosition]);

      // Start monitoring
      await sltpMonitor.startMonitoring('pos-123');

      // Update price to trigger stop loss
      const triggers = await sltpMonitor.updatePrice({
        symbol: 'EURUSD',
        price: 1.1949, // Below stop loss
        timestamp: new Date()
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].triggerType).toBe('STOP_LOSS');

      // Check priority queue stats
      const queueStats = sltpMonitor.getPriorityQueueStats();
      expect(queueStats.totalTriggers).toBeGreaterThan(0);
    });

    it('should provide queue statistics and monitoring', () => {
      const stats = sltpMonitor.getPriorityQueueStats();
      
      expect(stats).toHaveProperty('totalTriggers');
      expect(stats).toHaveProperty('pendingTriggers');
      expect(stats).toHaveProperty('processedTriggers');
      expect(stats).toHaveProperty('averageProcessingTimeMs');
      expect(stats).toHaveProperty('queueDepth');
      expect(stats).toHaveProperty('highPriorityCount');
      expect(stats).toHaveProperty('criticalCount');
    });

    it('should cancel pending triggers when position is closed', () => {
      const positionId = 'pos-cancel-test';
      
      // This would normally be called when a position is closed
      const canceledCount = sltpMonitor.cancelPendingTriggers(positionId);
      
      expect(typeof canceledCount).toBe('number');
      expect(canceledCount).toBeGreaterThanOrEqual(0);
    });

    it('should optimize queue performance', () => {
      const removedCount = sltpMonitor.optimizeQueue();
      
      expect(typeof removedCount).toBe('number');
      expect(removedCount).toBeGreaterThanOrEqual(0);
    });

    it('should track average response time', () => {
      const responseTime = sltpMonitor.getAverageResponseTime();
      
      expect(typeof responseTime).toBe('number');
      expect(responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should provide market data buffer', () => {
      const buffer = sltpMonitor.getMarketDataBuffer();
      
      expect(buffer).toBeInstanceOf(Map);
    });
  });

  describe('Performance Optimization', () => {
    it('should handle high-frequency price updates efficiently', async () => {
      const mockPosition = {
        id: 'pos-perf',
        status: PositionState.OPEN,
        side: 'BUY',
        size: 100000,
        avgEntryPrice: 1.2000,
        stopLoss: 1.1950,
        pair: 'EURUSD'
      };

      mockPositionRepository.findById.mockResolvedValue(mockPosition);
      await sltpMonitor.startMonitoring('pos-perf');

      const startTime = Date.now();
      
      // Send 100 price updates rapidly
      for (let i = 0; i < 100; i++) {
        await sltpMonitor.updatePrice({
          symbol: 'EURUSD',
          price: 1.2000 + (i * 0.0001), // Gradually increasing price
          timestamp: new Date()
        });
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should process 100 updates in reasonable time (less than 1 second)
      expect(processingTime).toBeLessThan(1000);
    });

    it('should maintain low latency for critical triggers', async () => {
      const criticalTrigger = {
        positionId: 'pos-critical',
        symbol: 'EURUSD',
        triggerPrice: 1.20000,
        currentPrice: 1.19999, // Very close to trigger
        side: 'BUY' as const,
        triggeredAt: new Date(),
        metadata: {
          positionSize: 1000000, // Large position
          riskLevel: 'HIGH' as const
        }
      };

      const startTime = Date.now();
      
      const triggerId = priorityQueue.addTrigger(criticalTrigger);
      
      const result = await priorityQueue.processNextTrigger(async () => {
        // Simulate fast execution
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      expect(result?.success).toBe(true);
      expect(totalTime).toBeLessThan(100); // Should be very fast for critical triggers
    });
  });
});