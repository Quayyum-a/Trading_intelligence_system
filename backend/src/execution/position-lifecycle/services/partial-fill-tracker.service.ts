/**
 * Partial Fill Tracker Service - Enhanced partial fill tracking with accurate quantity management
 * 
 * This service implements improved partial fill tracking system with:
 * - Accurate quantity management and remaining order calculations
 * - Fill aggregation and consistency checks
 * - Fill validation and error handling
 * 
 * Requirements: 2.2
 */

import { randomUUID } from 'crypto';
import { 
  FillData, 
  ExecutionType, 
  PositionState,
  TradeExecution 
} from '../types/position-lifecycle.types';

export interface PartialFill {
  id: string;
  positionId: string;
  orderId: string;
  fillId: string;
  executionType: ExecutionType;
  price: number;
  size: number;
  cumulativeSize: number;
  remainingSize: number;
  fillSequence: number;
  executedAt: Date;
  createdAt: Date;
}

export interface OrderTracker {
  id: string;
  positionId: string;
  orderId: string;
  orderType: ExecutionType;
  originalSize: number;
  filledSize: number;
  remainingSize: number;
  averageFillPrice: number;
  fillCount: number;
  isComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FillValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FillAggregation {
  orderId: string;
  totalFilled: number;
  averagePrice: number;
  fillCount: number;
  fills: PartialFill[];
  isComplete: boolean;
  remainingSize: number;
}

export interface IPartialFillTracker {
  /**
   * Track a new partial fill
   */
  trackPartialFill(positionId: string, fillData: FillData, orderSize: number, executionType: ExecutionType): Promise<PartialFill>;
  
  /**
   * Get all fills for an order
   */
  getOrderFills(orderId: string): Promise<PartialFill[]>;
  
  /**
   * Get fill aggregation for an order
   */
  getOrderAggregation(orderId: string): Promise<FillAggregation>;
  
  /**
   * Validate fill data consistency
   */
  validateFill(fillData: FillData, orderTracker: OrderTracker): Promise<FillValidationResult>;
  
  /**
   * Get remaining order quantity
   */
  getRemainingQuantity(orderId: string): Promise<number>;
  
  /**
   * Check if order is completely filled
   */
  isOrderComplete(orderId: string): Promise<boolean>;
  
  /**
   * Get order tracker
   */
  getOrderTracker(orderId: string): Promise<OrderTracker | null>;
  
  /**
   * Create or update order tracker
   */
  updateOrderTracker(orderId: string, positionId: string, orderSize: number, executionType: ExecutionType): Promise<OrderTracker>;
}

export class PartialFillTrackerService implements IPartialFillTracker {
  private readonly partialFills: Map<string, PartialFill[]> = new Map(); // orderId -> fills
  private readonly orderTrackers: Map<string, OrderTracker> = new Map(); // orderId -> tracker
  
  constructor(
    private readonly executionRepository: any, // Will be injected
    private readonly positionRepository: any // Will be injected
  ) {}

  async trackPartialFill(
    positionId: string, 
    fillData: FillData, 
    orderSize: number, 
    executionType: ExecutionType
  ): Promise<PartialFill> {
    // Get or create order tracker
    let orderTracker = await this.getOrderTracker(fillData.orderId);
    if (!orderTracker) {
      orderTracker = await this.updateOrderTracker(fillData.orderId, positionId, orderSize, executionType);
    }

    // Validate the fill
    const validation = await this.validateFill(fillData, orderTracker);
    if (!validation.isValid) {
      throw new Error(`Fill validation failed: ${validation.errors.join(', ')}`);
    }

    // Get existing fills for this order
    const existingFills = this.partialFills.get(fillData.orderId) || [];
    const fillSequence = existingFills.length + 1;
    const cumulativeSize = existingFills.reduce((sum, fill) => sum + fill.size, 0) + fillData.size;
    const remainingSize = Math.max(0, orderTracker.originalSize - cumulativeSize);

    // Create partial fill record
    const partialFill: PartialFill = {
      id: randomUUID(),
      positionId,
      orderId: fillData.orderId,
      fillId: randomUUID(),
      executionType,
      price: fillData.price,
      size: fillData.size,
      cumulativeSize,
      remainingSize,
      fillSequence,
      executedAt: fillData.executedAt,
      createdAt: new Date()
    };

    // Store the fill
    existingFills.push(partialFill);
    this.partialFills.set(fillData.orderId, existingFills);

    // Update order tracker
    orderTracker.filledSize = cumulativeSize;
    orderTracker.remainingSize = remainingSize;
    orderTracker.fillCount = fillSequence;
    orderTracker.isComplete = remainingSize === 0;
    orderTracker.updatedAt = new Date();

    // Calculate new average fill price
    orderTracker.averageFillPrice = this.calculateAverageFillPrice(existingFills);

    // Update tracker in storage
    this.orderTrackers.set(fillData.orderId, orderTracker);

    // Persist to database (if repository is available)
    try {
      if (this.executionRepository && this.executionRepository.createPartialFill) {
        await this.executionRepository.createPartialFill(partialFill);
      }
    } catch (error) {
      console.warn('Failed to persist partial fill to database:', error);
      // Continue execution - in-memory tracking is still valid
    }

    return partialFill;
  }

  async getOrderFills(orderId: string): Promise<PartialFill[]> {
    return this.partialFills.get(orderId) || [];
  }

  async getOrderAggregation(orderId: string): Promise<FillAggregation> {
    const fills = await this.getOrderFills(orderId);
    const orderTracker = await this.getOrderTracker(orderId);

    if (!orderTracker) {
      throw new Error(`Order tracker not found for order ${orderId}`);
    }

    const totalFilled = fills.reduce((sum, fill) => sum + fill.size, 0);
    const averagePrice = this.calculateAverageFillPrice(fills);

    return {
      orderId,
      totalFilled,
      averagePrice,
      fillCount: fills.length,
      fills,
      isComplete: orderTracker.isComplete,
      remainingSize: orderTracker.remainingSize
    };
  }

  async validateFill(fillData: FillData, orderTracker: OrderTracker): Promise<FillValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (fillData.size <= 0) {
      errors.push('Fill size must be positive');
    }

    if (fillData.price <= 0) {
      errors.push('Fill price must be positive');
    }

    if (!fillData.orderId) {
      errors.push('Order ID is required');
    }

    if (!fillData.executedAt) {
      errors.push('Execution timestamp is required');
    }

    // Order-specific validation
    if (orderTracker.isComplete) {
      errors.push('Cannot add fill to already completed order');
    }

    const currentFilled = orderTracker.filledSize;
    const newTotal = currentFilled + fillData.size;

    if (newTotal > orderTracker.originalSize) {
      errors.push(`Fill would exceed order size. Order: ${orderTracker.originalSize}, Current: ${currentFilled}, New fill: ${fillData.size}`);
    }

    // Precision validation (avoid floating point issues)
    const roundedFillSize = Math.round(fillData.size * 100) / 100;
    if (Math.abs(fillData.size - roundedFillSize) > 0.001) {
      warnings.push('Fill size has excessive precision, will be rounded');
    }

    // Time validation
    const now = new Date();
    if (fillData.executedAt > now) {
      errors.push('Fill execution time cannot be in the future');
    }

    // Check for duplicate fills (same size and price within short time window)
    const existingFills = this.partialFills.get(fillData.orderId) || [];
    const recentFills = existingFills.filter(fill => 
      Math.abs(fill.executedAt.getTime() - fillData.executedAt.getTime()) < 1000 // Within 1 second
    );

    const duplicateFill = recentFills.find(fill => 
      Math.abs(fill.size - fillData.size) < 0.001 && 
      Math.abs(fill.price - fillData.price) < 0.001
    );

    if (duplicateFill) {
      warnings.push('Potential duplicate fill detected');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  async getRemainingQuantity(orderId: string): Promise<number> {
    const orderTracker = await this.getOrderTracker(orderId);
    return orderTracker ? orderTracker.remainingSize : 0;
  }

  async isOrderComplete(orderId: string): Promise<boolean> {
    const orderTracker = await this.getOrderTracker(orderId);
    return orderTracker ? orderTracker.isComplete : false;
  }

  async getOrderTracker(orderId: string): Promise<OrderTracker | null> {
    return this.orderTrackers.get(orderId) || null;
  }

  async updateOrderTracker(
    orderId: string, 
    positionId: string, 
    orderSize: number, 
    executionType: ExecutionType
  ): Promise<OrderTracker> {
    const existing = this.orderTrackers.get(orderId);
    
    if (existing) {
      // Update existing tracker
      existing.updatedAt = new Date();
      return existing;
    }

    // Create new tracker
    const tracker: OrderTracker = {
      id: randomUUID(),
      positionId,
      orderId,
      orderType: executionType,
      originalSize: orderSize,
      filledSize: 0,
      remainingSize: orderSize,
      averageFillPrice: 0,
      fillCount: 0,
      isComplete: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.orderTrackers.set(orderId, tracker);
    return tracker;
  }

  /**
   * Calculate weighted average fill price
   */
  private calculateAverageFillPrice(fills: PartialFill[]): number {
    if (fills.length === 0) return 0;

    const totalValue = fills.reduce((sum, fill) => sum + (fill.price * fill.size), 0);
    const totalSize = fills.reduce((sum, fill) => sum + fill.size, 0);

    return totalSize > 0 ? totalValue / totalSize : 0;
  }

  /**
   * Get fill statistics for monitoring
   */
  async getFillStatistics(): Promise<{
    totalOrders: number;
    completedOrders: number;
    partialOrders: number;
    totalFills: number;
    averageFillsPerOrder: number;
  }> {
    const totalOrders = this.orderTrackers.size;
    const completedOrders = Array.from(this.orderTrackers.values()).filter(t => t.isComplete).length;
    const partialOrders = totalOrders - completedOrders;
    const totalFills = Array.from(this.partialFills.values()).reduce((sum, fills) => sum + fills.length, 0);
    const averageFillsPerOrder = totalOrders > 0 ? totalFills / totalOrders : 0;

    return {
      totalOrders,
      completedOrders,
      partialOrders,
      totalFills,
      averageFillsPerOrder: Math.round(averageFillsPerOrder * 100) / 100
    };
  }

  /**
   * Clean up completed orders (for memory management)
   */
  async cleanupCompletedOrders(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffTime = new Date(Date.now() - olderThanMs);
    let cleanedCount = 0;

    for (const [orderId, tracker] of this.orderTrackers.entries()) {
      if (tracker.isComplete && tracker.updatedAt < cutoffTime) {
        this.orderTrackers.delete(orderId);
        this.partialFills.delete(orderId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Validate system consistency
   */
  async validateSystemConsistency(): Promise<{
    isConsistent: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check that all fills have corresponding order trackers
    for (const [orderId, fills] of this.partialFills.entries()) {
      const tracker = this.orderTrackers.get(orderId);
      if (!tracker) {
        issues.push(`Fills exist for order ${orderId} but no order tracker found`);
        continue;
      }

      // Validate fill count matches
      if (tracker.fillCount !== fills.length) {
        issues.push(`Fill count mismatch for order ${orderId}: tracker=${tracker.fillCount}, actual=${fills.length}`);
      }

      // Validate cumulative size
      const actualFilledSize = fills.reduce((sum, fill) => sum + fill.size, 0);
      if (Math.abs(tracker.filledSize - actualFilledSize) > 0.001) {
        issues.push(`Filled size mismatch for order ${orderId}: tracker=${tracker.filledSize}, actual=${actualFilledSize}`);
      }

      // Validate remaining size
      const expectedRemaining = tracker.originalSize - actualFilledSize;
      if (Math.abs(tracker.remainingSize - expectedRemaining) > 0.001) {
        issues.push(`Remaining size mismatch for order ${orderId}: tracker=${tracker.remainingSize}, expected=${expectedRemaining}`);
      }

      // Validate completion status
      const shouldBeComplete = expectedRemaining <= 0.001;
      if (tracker.isComplete !== shouldBeComplete) {
        issues.push(`Completion status mismatch for order ${orderId}: tracker=${tracker.isComplete}, expected=${shouldBeComplete}`);
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues
    };
  }
}