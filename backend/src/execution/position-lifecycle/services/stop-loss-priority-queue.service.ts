/**
 * Stop Loss Priority Queue Service - Optimized stop loss trigger processing
 * 
 * This service implements:
 * - Real-time market data monitoring for stop loss
 * - Priority queue for stop loss execution
 * - Optimized trigger response time and execution latency
 * 
 * Requirements: 2.3
 */

import { randomUUID } from 'crypto';

export interface StopLossTrigger {
  id: string;
  positionId: string;
  symbol: string;
  triggerPrice: number;
  currentPrice: number;
  side: 'BUY' | 'SELL';
  priority: number; // Higher number = higher priority
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: Date;
  triggeredAt: Date;
  metadata?: Record<string, any>;
}

export interface PriorityQueueStats {
  totalTriggers: number;
  pendingTriggers: number;
  processedTriggers: number;
  averageProcessingTimeMs: number;
  queueDepth: number;
  highPriorityCount: number;
  criticalCount: number;
}

export interface ProcessingResult {
  triggerId: string;
  success: boolean;
  processingTimeMs: number;
  error?: string;
}

export class StopLossPriorityQueueService {
  private readonly triggerQueue: StopLossTrigger[] = [];
  private readonly processingHistory: Map<string, ProcessingResult> = new Map();
  private readonly symbolPrices: Map<string, { price: number; timestamp: Date }> = new Map();
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  
  // Performance tracking
  private totalProcessingTime = 0;
  private processedCount = 0;
  
  constructor(
    private readonly processingIntervalMs: number = 100, // Process every 100ms
    private readonly maxQueueSize: number = 1000,
    private readonly maxProcessingTimeMs: number = 5000 // 5 second timeout per trigger
  ) {}

  /**
   * Add a stop loss trigger to the priority queue
   */
  addTrigger(trigger: Omit<StopLossTrigger, 'id' | 'createdAt' | 'priority' | 'urgency'>): string {
    const triggerWithId: StopLossTrigger = {
      ...trigger,
      id: randomUUID(),
      createdAt: new Date(),
      priority: this.calculatePriority(trigger),
      urgency: this.calculateUrgency(trigger)
    };

    // Check queue capacity
    if (this.triggerQueue.length >= this.maxQueueSize) {
      // Remove lowest priority trigger to make room
      this.removeLowestPriorityTrigger();
    }

    // Insert trigger in priority order (highest priority first)
    this.insertTriggerByPriority(triggerWithId);

    // Start processing if not already running
    if (!this.isProcessing) {
      this.startProcessing();
    }

    return triggerWithId.id;
  }

  /**
   * Update market price for a symbol
   */
  updateMarketPrice(symbol: string, price: number): void {
    this.symbolPrices.set(symbol, {
      price,
      timestamp: new Date()
    });

    // Update priorities of existing triggers for this symbol
    this.updateTriggerPriorities(symbol, price);
  }

  /**
   * Get current queue statistics
   */
  getQueueStats(): PriorityQueueStats {
    const highPriorityCount = this.triggerQueue.filter(t => t.priority >= 80).length;
    const criticalCount = this.triggerQueue.filter(t => t.urgency === 'CRITICAL').length;

    return {
      totalTriggers: this.processingHistory.size + this.triggerQueue.length,
      pendingTriggers: this.triggerQueue.length,
      processedTriggers: this.processingHistory.size,
      averageProcessingTimeMs: this.processedCount > 0 ? this.totalProcessingTime / this.processedCount : 0,
      queueDepth: this.triggerQueue.length,
      highPriorityCount,
      criticalCount
    };
  }

  /**
   * Get pending triggers for a position
   */
  getPendingTriggers(positionId: string): StopLossTrigger[] {
    return this.triggerQueue.filter(t => t.positionId === positionId);
  }

  /**
   * Cancel pending triggers for a position
   */
  cancelTriggersForPosition(positionId: string): number {
    const initialLength = this.triggerQueue.length;
    
    // Remove all triggers for this position
    for (let i = this.triggerQueue.length - 1; i >= 0; i--) {
      if (this.triggerQueue[i].positionId === positionId) {
        this.triggerQueue.splice(i, 1);
      }
    }

    return initialLength - this.triggerQueue.length;
  }

  /**
   * Process the next trigger in the queue
   */
  async processNextTrigger(
    executionCallback: (trigger: StopLossTrigger) => Promise<void>
  ): Promise<ProcessingResult | null> {
    if (this.triggerQueue.length === 0) {
      return null;
    }

    const trigger = this.triggerQueue.shift()!;
    const startTime = Date.now();

    try {
      // Execute the trigger with timeout
      await Promise.race([
        executionCallback(trigger),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Processing timeout')), this.maxProcessingTimeMs)
        )
      ]);

      const processingTime = Date.now() - startTime;
      this.updateProcessingStats(processingTime);

      const result: ProcessingResult = {
        triggerId: trigger.id,
        success: true,
        processingTimeMs: processingTime
      };

      this.processingHistory.set(trigger.id, result);
      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const result: ProcessingResult = {
        triggerId: trigger.id,
        success: false,
        processingTimeMs: processingTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.processingHistory.set(trigger.id, result);
      return result;
    }
  }

  /**
   * Start continuous processing
   */
  startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processingInterval = setInterval(() => {
      if (this.triggerQueue.length === 0) {
        this.stopProcessing();
      }
    }, this.processingIntervalMs);
  }

  /**
   * Stop continuous processing
   */
  stopProcessing(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  /**
   * Clear all triggers and reset state
   */
  clear(): void {
    this.stopProcessing();
    this.triggerQueue.length = 0;
    this.processingHistory.clear();
    this.symbolPrices.clear();
    this.totalProcessingTime = 0;
    this.processedCount = 0;
  }

  /**
   * Get processing history for a trigger
   */
  getProcessingResult(triggerId: string): ProcessingResult | null {
    return this.processingHistory.get(triggerId) || null;
  }

  /**
   * Calculate priority based on trigger characteristics
   */
  private calculatePriority(trigger: Omit<StopLossTrigger, 'id' | 'createdAt' | 'priority' | 'urgency'>): number {
    let priority = 50; // Base priority

    // Price distance factor (closer to trigger = higher priority)
    const priceDistance = Math.abs(trigger.currentPrice - trigger.triggerPrice);
    const relativeDistance = priceDistance / trigger.triggerPrice;
    
    if (relativeDistance < 0.001) { // Very close (0.1%)
      priority += 40;
    } else if (relativeDistance < 0.005) { // Close (0.5%)
      priority += 30;
    } else if (relativeDistance < 0.01) { // Moderate (1%)
      priority += 20;
    } else if (relativeDistance < 0.02) { // Far (2%)
      priority += 10;
    }

    // Position size factor (larger positions get higher priority)
    if (trigger.metadata?.positionSize) {
      const size = trigger.metadata.positionSize;
      if (size > 100000) priority += 20; // Large position
      else if (size > 50000) priority += 15; // Medium-large position
      else if (size > 10000) priority += 10; // Medium position
      else if (size > 1000) priority += 5; // Small position
    }

    // Risk factor (higher risk = higher priority)
    if (trigger.metadata?.riskLevel) {
      const risk = trigger.metadata.riskLevel;
      if (risk === 'HIGH') priority += 25;
      else if (risk === 'MEDIUM') priority += 15;
      else if (risk === 'LOW') priority += 5;
    }

    // Time factor (older triggers get slightly higher priority)
    const ageMs = Date.now() - trigger.triggeredAt.getTime();
    if (ageMs > 10000) priority += 10; // Over 10 seconds old
    else if (ageMs > 5000) priority += 5; // Over 5 seconds old

    return Math.min(100, Math.max(0, priority));
  }

  /**
   * Calculate urgency level
   */
  private calculateUrgency(trigger: Omit<StopLossTrigger, 'id' | 'createdAt' | 'priority' | 'urgency'>): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const priceDistance = Math.abs(trigger.currentPrice - trigger.triggerPrice);
    const relativeDistance = priceDistance / trigger.triggerPrice;

    if (relativeDistance < 0.0005) return 'CRITICAL'; // 0.05%
    if (relativeDistance < 0.002) return 'HIGH'; // 0.2%
    if (relativeDistance < 0.01) return 'MEDIUM'; // 1%
    return 'LOW';
  }

  /**
   * Insert trigger maintaining priority order
   */
  private insertTriggerByPriority(trigger: StopLossTrigger): void {
    let insertIndex = 0;
    
    // Find insertion point (highest priority first)
    while (insertIndex < this.triggerQueue.length && 
           this.triggerQueue[insertIndex].priority >= trigger.priority) {
      insertIndex++;
    }

    this.triggerQueue.splice(insertIndex, 0, trigger);
  }

  /**
   * Remove the lowest priority trigger
   */
  private removeLowestPriorityTrigger(): void {
    if (this.triggerQueue.length === 0) return;

    // Queue is sorted by priority, so last element has lowest priority
    this.triggerQueue.pop();
  }

  /**
   * Update trigger priorities when market price changes
   */
  private updateTriggerPriorities(symbol: string, newPrice: number): void {
    let needsResorting = false;

    for (const trigger of this.triggerQueue) {
      if (trigger.symbol === symbol) {
        const oldPriority = trigger.priority;
        trigger.currentPrice = newPrice;
        trigger.priority = this.calculatePriority(trigger);
        trigger.urgency = this.calculateUrgency(trigger);

        if (trigger.priority !== oldPriority) {
          needsResorting = true;
        }
      }
    }

    // Re-sort queue if priorities changed
    if (needsResorting) {
      this.triggerQueue.sort((a, b) => b.priority - a.priority);
    }
  }

  /**
   * Update processing statistics
   */
  private updateProcessingStats(processingTimeMs: number): void {
    this.totalProcessingTime += processingTimeMs;
    this.processedCount++;
  }

  /**
   * Get triggers by urgency level
   */
  getTriggersByUrgency(urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): StopLossTrigger[] {
    return this.triggerQueue.filter(t => t.urgency === urgency);
  }

  /**
   * Get average queue wait time
   */
  getAverageQueueWaitTime(): number {
    if (this.triggerQueue.length === 0) return 0;

    const now = Date.now();
    const totalWaitTime = this.triggerQueue.reduce((sum, trigger) => {
      return sum + (now - trigger.createdAt.getTime());
    }, 0);

    return totalWaitTime / this.triggerQueue.length;
  }

  /**
   * Optimize queue performance by removing stale triggers
   */
  optimizeQueue(maxAgeMs: number = 60000): number {
    const cutoffTime = Date.now() - maxAgeMs;
    const initialLength = this.triggerQueue.length;

    // Remove stale triggers (check both createdAt and triggeredAt)
    for (let i = this.triggerQueue.length - 1; i >= 0; i--) {
      const trigger = this.triggerQueue[i];
      const triggerAge = Math.min(trigger.createdAt.getTime(), trigger.triggeredAt.getTime());
      
      if (triggerAge < cutoffTime) {
        this.triggerQueue.splice(i, 1);
      }
    }

    return initialLength - this.triggerQueue.length;
  }
}