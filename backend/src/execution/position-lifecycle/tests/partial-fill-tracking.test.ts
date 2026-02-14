/**
 * Partial Fill Tracking System Tests
 * 
 * Tests the enhanced partial fill tracking system with:
 * - Accurate quantity management and remaining order calculations
 * - Fill aggregation and consistency checks
 * - Fill validation and error handling
 * 
 * Requirements: 2.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PartialFillTrackerService } from '../services/partial-fill-tracker.service';
import { ExecutionTrackingService } from '../services/execution-tracking.service';
import { 
  FillData, 
  ExecutionType, 
  PositionState 
} from '../types/position-lifecycle.types';

describe('Partial Fill Tracking System', () => {
  let partialFillTracker: PartialFillTrackerService;
  let executionTracking: ExecutionTrackingService;
  let mockExecutionRepository: any;
  let mockPositionRepository: any;
  let mockStateMachine: any;
  let mockEventService: any;

  beforeEach(() => {
    // Mock repositories and services
    mockExecutionRepository = {
      create: vi.fn(),
      createPartialFill: vi.fn(),
    };

    mockPositionRepository = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockStateMachine = {
      transitionState: vi.fn(),
    };

    mockEventService = {
      emitEvent: vi.fn(),
    };

    // Initialize services
    partialFillTracker = new PartialFillTrackerService(
      mockExecutionRepository,
      mockPositionRepository
    );

    executionTracking = new ExecutionTrackingService(
      mockExecutionRepository,
      mockPositionRepository,
      mockStateMachine,
      mockEventService
    );
  });

  describe('PartialFillTrackerService', () => {
    describe('Order Tracker Management', () => {
      it('should create new order tracker', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;
        const executionType = ExecutionType.ENTRY;

        const tracker = await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          executionType
        );

        expect(tracker).toBeDefined();
        expect(tracker.orderId).toBe(orderId);
        expect(tracker.positionId).toBe(positionId);
        expect(tracker.originalSize).toBe(orderSize);
        expect(tracker.orderType).toBe(executionType);
        expect(tracker.filledSize).toBe(0);
        expect(tracker.remainingSize).toBe(orderSize);
        expect(tracker.isComplete).toBe(false);
      });

      it('should return existing order tracker', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create initial tracker
        const tracker1 = await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Try to create again - should return existing
        const tracker2 = await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        expect(tracker1.id).toBe(tracker2.id);
        expect(tracker1.createdAt).toEqual(tracker2.createdAt);
      });
    });

    describe('Partial Fill Tracking', () => {
      it('should track single partial fill correctly', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;
        const fillSize = 30;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Create fill data
        const fillData: FillData = {
          orderId,
          price: 1.2345,
          size: fillSize,
          executedAt: new Date()
        };

        // Track the fill
        const partialFill = await partialFillTracker.trackPartialFill(
          positionId,
          fillData,
          orderSize,
          ExecutionType.ENTRY
        );

        expect(partialFill).toBeDefined();
        expect(partialFill.orderId).toBe(orderId);
        expect(partialFill.size).toBe(fillSize);
        expect(partialFill.cumulativeSize).toBe(fillSize);
        expect(partialFill.remainingSize).toBe(orderSize - fillSize);
        expect(partialFill.fillSequence).toBe(1);

        // Check order tracker was updated
        const tracker = await partialFillTracker.getOrderTracker(orderId);
        expect(tracker?.filledSize).toBe(fillSize);
        expect(tracker?.remainingSize).toBe(orderSize - fillSize);
        expect(tracker?.fillCount).toBe(1);
        expect(tracker?.isComplete).toBe(false);
      });

      it('should track multiple partial fills correctly', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // First fill
        const fill1: FillData = {
          orderId,
          price: 1.2345,
          size: 30,
          executedAt: new Date()
        };

        const partialFill1 = await partialFillTracker.trackPartialFill(
          positionId,
          fill1,
          orderSize,
          ExecutionType.ENTRY
        );

        expect(partialFill1.cumulativeSize).toBe(30);
        expect(partialFill1.remainingSize).toBe(70);
        expect(partialFill1.fillSequence).toBe(1);

        // Second fill
        const fill2: FillData = {
          orderId,
          price: 1.2350,
          size: 40,
          executedAt: new Date()
        };

        const partialFill2 = await partialFillTracker.trackPartialFill(
          positionId,
          fill2,
          orderSize,
          ExecutionType.ENTRY
        );

        expect(partialFill2.cumulativeSize).toBe(70);
        expect(partialFill2.remainingSize).toBe(30);
        expect(partialFill2.fillSequence).toBe(2);

        // Check order tracker
        const tracker = await partialFillTracker.getOrderTracker(orderId);
        expect(tracker?.filledSize).toBe(70);
        expect(tracker?.remainingSize).toBe(30);
        expect(tracker?.fillCount).toBe(2);
        expect(tracker?.isComplete).toBe(false);
      });

      it('should complete order when fully filled', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Fill the entire order
        const fillData: FillData = {
          orderId,
          price: 1.2345,
          size: orderSize,
          executedAt: new Date()
        };

        const partialFill = await partialFillTracker.trackPartialFill(
          positionId,
          fillData,
          orderSize,
          ExecutionType.ENTRY
        );

        expect(partialFill.cumulativeSize).toBe(orderSize);
        expect(partialFill.remainingSize).toBe(0);

        // Check order is complete
        const isComplete = await partialFillTracker.isOrderComplete(orderId);
        expect(isComplete).toBe(true);

        const tracker = await partialFillTracker.getOrderTracker(orderId);
        expect(tracker?.isComplete).toBe(true);
      });

      it('should calculate average fill price correctly', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // First fill at 1.2300
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2300, size: 40, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        // Second fill at 1.2400
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2400, size: 60, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        // Expected average: (1.2300 * 40 + 1.2400 * 60) / 100 = 1.2360
        const tracker = await partialFillTracker.getOrderTracker(orderId);
        expect(tracker?.averageFillPrice).toBeCloseTo(1.2360, 3);
      });
    });

    describe('Fill Validation', () => {
      it('should validate fill data correctly', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        const tracker = await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Valid fill
        const validFill: FillData = {
          orderId,
          price: 1.2345,
          size: 30,
          executedAt: new Date()
        };

        const validResult = await partialFillTracker.validateFill(validFill, tracker);
        expect(validResult.isValid).toBe(true);
        expect(validResult.errors).toHaveLength(0);

        // Invalid fill - negative size
        const invalidFill: FillData = {
          orderId,
          price: 1.2345,
          size: -10,
          executedAt: new Date()
        };

        const invalidResult = await partialFillTracker.validateFill(invalidFill, tracker);
        expect(invalidResult.isValid).toBe(false);
        expect(invalidResult.errors).toContain('Fill size must be positive');
      });

      it('should prevent overfilling orders', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        const tracker = await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Fill 80 units first
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2345, size: 80, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        // Try to fill 30 more units (would exceed order size)
        const updatedTracker = await partialFillTracker.getOrderTracker(orderId);
        const overfillData: FillData = {
          orderId,
          price: 1.2345,
          size: 30,
          executedAt: new Date()
        };

        const validation = await partialFillTracker.validateFill(overfillData, updatedTracker!);
        expect(validation.isValid).toBe(false);
        expect(validation.errors.some(e => e.includes('exceed order size'))).toBe(true);
      });

      it('should prevent fills on completed orders', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create and complete order
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2345, size: orderSize, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        // Try to add another fill
        const tracker = await partialFillTracker.getOrderTracker(orderId);
        const extraFill: FillData = {
          orderId,
          price: 1.2345,
          size: 10,
          executedAt: new Date()
        };

        const validation = await partialFillTracker.validateFill(extraFill, tracker!);
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('Cannot add fill to already completed order');
      });
    });

    describe('Fill Aggregation', () => {
      it('should provide correct fill aggregation', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Add multiple fills
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2300, size: 30, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2400, size: 40, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        const aggregation = await partialFillTracker.getOrderAggregation(orderId);

        expect(aggregation.orderId).toBe(orderId);
        expect(aggregation.totalFilled).toBe(70);
        expect(aggregation.fillCount).toBe(2);
        expect(aggregation.fills).toHaveLength(2);
        expect(aggregation.isComplete).toBe(false);
        expect(aggregation.remainingSize).toBe(30);
        expect(aggregation.averagePrice).toBeCloseTo(1.2357, 3); // Weighted average
      });
    });

    describe('System Consistency', () => {
      it('should validate system consistency', async () => {
        const orderId = 'order-123';
        const positionId = 'pos-456';
        const orderSize = 100;

        // Create order tracker
        await partialFillTracker.updateOrderTracker(
          orderId, 
          positionId, 
          orderSize, 
          ExecutionType.ENTRY
        );

        // Add fills
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2300, size: 30, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId, price: 1.2400, size: 40, executedAt: new Date() },
          orderSize,
          ExecutionType.ENTRY
        );

        const consistency = await partialFillTracker.validateSystemConsistency();
        expect(consistency.isConsistent).toBe(true);
        expect(consistency.issues).toHaveLength(0);
      });
    });

    describe('Statistics and Monitoring', () => {
      it('should provide fill statistics', async () => {
        const orderId1 = 'order-123';
        const orderId2 = 'order-456';
        const positionId = 'pos-789';

        // Create two orders
        await partialFillTracker.updateOrderTracker(orderId1, positionId, 100, ExecutionType.ENTRY);
        await partialFillTracker.updateOrderTracker(orderId2, positionId, 50, ExecutionType.ENTRY);

        // Fill first order completely
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId: orderId1, price: 1.2300, size: 100, executedAt: new Date() },
          100,
          ExecutionType.ENTRY
        );

        // Partially fill second order
        await partialFillTracker.trackPartialFill(
          positionId,
          { orderId: orderId2, price: 1.2400, size: 25, executedAt: new Date() },
          50,
          ExecutionType.ENTRY
        );

        const stats = await partialFillTracker.getFillStatistics();

        expect(stats.totalOrders).toBe(2);
        expect(stats.completedOrders).toBe(1);
        expect(stats.partialOrders).toBe(1);
        expect(stats.totalFills).toBe(2);
        expect(stats.averageFillsPerOrder).toBe(1);
      });
    });
  });

  describe('ExecutionTrackingService Integration', () => {
    it('should integrate with partial fill tracker', async () => {
      const positionId = 'pos-123';
      const orderId = 'order-456';

      // Mock position
      const mockPosition = {
        id: positionId,
        status: PositionState.PENDING,
        size: 0,
        avgEntryPrice: 0,
        accountId: 'account-123'
      };

      mockPositionRepository.findById.mockResolvedValue(mockPosition);
      mockExecutionRepository.create.mockResolvedValue({});

      const fillData: FillData = {
        orderId,
        price: 1.2345,
        size: 30,
        executedAt: new Date()
      };

      // Process partial fill
      await executionTracking.processPartialFill(positionId, fillData, true);

      // Verify partial fill tracker was used
      const tracker = executionTracking.getPartialFillTracker();
      const orderTracker = await tracker.getOrderTracker(orderId);
      
      expect(orderTracker).toBeDefined();
      expect(orderTracker?.filledSize).toBe(30);

      const fills = await tracker.getOrderFills(orderId);
      expect(fills).toHaveLength(1);
      expect(fills[0].size).toBe(30);
    });

    it('should provide fill aggregation through execution tracking', async () => {
      const positionId = 'pos-123';
      const orderId = 'order-456';

      // Mock position
      mockPositionRepository.findById.mockResolvedValue({
        id: positionId,
        status: PositionState.PENDING,
        size: 0,
        avgEntryPrice: 0
      });

      mockExecutionRepository.create.mockResolvedValue({});

      // Process multiple fills with reasonable sizes
      await executionTracking.processPartialFill(positionId, {
        orderId, price: 1.2300, size: 30, executedAt: new Date()
      }, true);

      await executionTracking.processPartialFill(positionId, {
        orderId, price: 1.2400, size: 20, executedAt: new Date() // Reduced size to avoid exceeding estimated order size
      }, true);

      // Get aggregation
      const aggregation = await executionTracking.getOrderFillAggregation(orderId);
      
      expect(aggregation.totalFilled).toBe(50);
      expect(aggregation.fillCount).toBe(2);
      expect(aggregation.isComplete).toBe(false);

      // Check remaining quantity
      const remaining = await executionTracking.getRemainingOrderQuantity(orderId);
      expect(remaining).toBeGreaterThan(0);

      // Check completion status
      const isComplete = await executionTracking.isOrderCompletelyFilled(orderId);
      expect(isComplete).toBe(false);
    });
  });
});