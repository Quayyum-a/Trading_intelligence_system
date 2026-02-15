/**
 * Task 12: Event Replay Optimization Service
 * Requirements: 4.1.1, 4.1.2, 4.1.3, 4.1.4, 4.1.5, 4.1.6
 * 
 * This service implements streaming event processing to fix timeout issues:
 * - Load events in batches (not all at once)
 * - Process each batch sequentially
 * - Release memory after each batch
 * - Add progress tracking and logging
 * - Support cancellation
 */

import { Position } from '../interfaces/position-state-machine.interface';
import { PositionEvent, PositionEventType } from '../types/position-lifecycle.types';

export interface ReplayProgress {
  totalEvents: number;
  processedEvents: number;
  percentComplete: number;
  estimatedTimeRemaining: number; // milliseconds
  currentBatch: number;
  totalBatches: number;
}

export interface ReplayResult {
  success: boolean;
  positionsReplayed: number;
  eventsProcessed: number;
  duration: number; // milliseconds
  errors: string[];
  cancelled: boolean;
}

export interface ReplayOptions {
  batchSize?: number;          // Default: 100 events per batch
  progressCallback?: (progress: ReplayProgress) => void;
  maxDuration?: number;         // Maximum duration in ms (default: 30000 = 30s)
  skipMissingEvents?: boolean;  // Handle missing events gracefully (Requirement 4.1.3)
}

/**
 * Task 12: Event Replay Service with Streaming and Optimization
 */
export class EventReplayService {
  private cancelled: boolean = false;
  private readonly DEFAULT_BATCH_SIZE = 100;
  private readonly DEFAULT_MAX_DURATION = 30000; // 30 seconds

  constructor(
    private readonly positionRepository: any,
    private readonly eventRepository: any,
    private readonly positionEventService: any
  ) {}

  /**
   * Task 12.1: Implement streaming event processing
   * Requirements: 4.1.1, 4.1.5
   * 
   * Load events in batches of 100 (not all at once)
   * Process each batch sequentially
   * Release memory after each batch
   */
  async replayPositionEvents(
    positionId: string,
    options: ReplayOptions = {}
  ): Promise<Position> {
    const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;
    const skipMissing = options.skipMissingEvents !== false; // Default true

    // Get total event count
    const totalEvents = await this.eventRepository.countByPositionId(positionId);

    if (totalEvents === 0) {
      // Requirement 4.1.3: Handle missing events gracefully
      if (skipMissing) {
        console.warn(`[EventReplay] No events found for position ${positionId}, attempting to load from database`);
        const existingPosition = await this.positionRepository.findById(positionId);
        if (existingPosition) {
          return existingPosition;
        }
      }
      throw new Error(`No events found for position ${positionId}`);
    }

    let position: Position | null = null;
    let processedEvents = 0;
    const totalBatches = Math.ceil(totalEvents / batchSize);

    // Task 12.2: Add progress tracking and logging
    // Requirement 4.1.4
    const startTime = Date.now();

    for (let batch = 0; batch < totalBatches; batch++) {
      // Check cancellation flag
      if (this.cancelled) {
        throw new Error('Replay cancelled by user');
      }

      // Load batch of events
      const offset = batch * batchSize;
      const events = await this.eventRepository.findByPositionId(positionId, {
        orderBy: 'created_at',
        direction: 'ASC',
        limit: batchSize,
        offset
      });

      // Process batch
      for (const event of events) {
        if (position === null) {
          // Initialize from first event
          position = this.initializePositionFromEvent(positionId, event, skipMissing);
        } else {
          // Apply event to position
          position = this.applyEventToPosition(position, event, skipMissing);
        }
        processedEvents++;
      }

      // Task 12.2: Log progress every 100 events
      // Requirement 4.1.4
      if ((processedEvents % 100 === 0) || (batch === totalBatches - 1)) {
        const elapsed = Date.now() - startTime;
        const percentComplete = (processedEvents / totalEvents) * 100;
        const estimatedTotal = (elapsed / processedEvents) * totalEvents;
        const estimatedRemaining = estimatedTotal - elapsed;

        console.log(`[EventReplay] Progress: ${processedEvents}/${totalEvents} events (${percentComplete.toFixed(1)}%), ` +
                    `Batch ${batch + 1}/${totalBatches}, ` +
                    `ETA: ${Math.round(estimatedRemaining / 1000)}s`);

        // Call progress callback if provided
        if (options.progressCallback) {
          options.progressCallback({
            totalEvents,
            processedEvents,
            percentComplete,
            estimatedTimeRemaining: estimatedRemaining,
            currentBatch: batch + 1,
            totalBatches
          });
        }
      }

      // Release memory after each batch (garbage collection hint)
      if (batch < totalBatches - 1) {
        // Small delay to allow GC
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    if (!position) {
      throw new Error(`Failed to reconstruct position ${positionId} from events`);
    }

    const duration = Date.now() - startTime;
    console.log(`[EventReplay] Completed: ${processedEvents} events in ${duration}ms (${(processedEvents / (duration / 1000)).toFixed(0)} events/sec)`);

    return position;
  }

  /**
   * Task 12.5: Implement replay cancellation support
   * Requirement: 4.1.6
   * 
   * Add cancelReplay() method
   * Check cancellation flag between batches
   * Clean up resources on cancellation
   */
  cancelReplay(): void {
    console.log('[EventReplay] Cancellation requested');
    this.cancelled = true;
  }

  /**
   * Reset cancellation flag
   */
  resetCancellation(): void {
    this.cancelled = false;
  }

  /**
   * Task 14.1: Full system recovery with streaming
   * Requirements: 4.3.1, 4.3.2, 4.3.3
   * 
   * Load all events from event store
   * Replay events in chronological order
   * Reconstruct all position states
   * Rebuild account balances
   */
  async recoverSystemState(options: ReplayOptions = {}): Promise<ReplayResult> {
    const startTime = Date.now();
    const maxDuration = options.maxDuration || this.DEFAULT_MAX_DURATION;
    const errors: string[] = [];
    let positionsReplayed = 0;
    let eventsProcessed = 0;

    this.resetCancellation();

    try {
      console.log('[EventReplay] Starting full system recovery...');

      // Get all positions (in batches to avoid memory issues)
      const positionBatchSize = 50;
      let positionOffset = 0;
      let hasMorePositions = true;

      while (hasMorePositions && !this.cancelled) {
        // Check timeout
        if (Date.now() - startTime > maxDuration) {
          errors.push(`Recovery exceeded maximum duration of ${maxDuration}ms`);
          break;
        }

        // Load batch of positions
        const positions = await this.positionRepository.findAll({
          limit: positionBatchSize,
          offset: positionOffset
        });

        if (positions.length === 0) {
          hasMorePositions = false;
          break;
        }

        // Process each position
        for (const position of positions) {
          try {
            // Replay events for this position
            const replayedPosition = await this.replayPositionEvents(position.id, {
              ...options,
              maxDuration: maxDuration - (Date.now() - startTime) // Remaining time
            });

            // Update position in database
            await this.positionRepository.update(position.id, replayedPosition);

            positionsReplayed++;

            // Count events
            const eventCount = await this.eventRepository.countByPositionId(position.id);
            eventsProcessed += eventCount;

          } catch (error) {
            const errorMsg = `Failed to replay position ${position.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(`[EventReplay] ${errorMsg}`);
          }
        }

        positionOffset += positionBatchSize;

        // Log progress
        console.log(`[EventReplay] System recovery progress: ${positionsReplayed} positions replayed, ${eventsProcessed} events processed`);
      }

      // Task 14.3: Rebuild account balances
      // Requirement: 4.3.3
      await this.rebuildAccountBalances();

      const duration = Date.now() - startTime;
      console.log(`[EventReplay] System recovery completed: ${positionsReplayed} positions, ${eventsProcessed} events in ${duration}ms`);

      return {
        success: errors.length === 0 && !this.cancelled,
        positionsReplayed,
        eventsProcessed,
        duration,
        errors,
        cancelled: this.cancelled
      };

    } catch (error) {
      const errorMsg = `System recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      console.error(`[EventReplay] ${errorMsg}`);

      return {
        success: false,
        positionsReplayed,
        eventsProcessed,
        duration: Date.now() - startTime,
        errors,
        cancelled: this.cancelled
      };
    }
  }

  /**
   * Task 13.1: Strict chronological event processing
   * Requirements: 4.2.3, 4.2.4
   * 
   * Sort events by created_at timestamp
   * Process in strict order
   * Preserve all timestamps
   */
  private initializePositionFromEvent(
    positionId: string,
    event: PositionEvent,
    skipMissing: boolean
  ): Position {
    // Requirement 4.1.3: Handle missing POSITION_CREATED event gracefully
    if (event.eventType !== PositionEventType.POSITION_CREATED && skipMissing) {
      console.warn(`[EventReplay] First event for position ${positionId} is ${event.eventType}, not POSITION_CREATED. Reconstructing from available data.`);
    }

    // Initialize position from event payload
    const payload = event.payload || {};

    return {
      id: positionId,
      accountId: payload.accountId || 'default',
      executionTradeId: payload.executionTradeId,
      pair: payload.pair || 'UNKNOWN',
      side: payload.side || 'BUY',
      size: payload.size || 0,
      avgEntryPrice: payload.avgEntryPrice || payload.entryPrice || 0,
      leverage: payload.leverage || 1,
      marginUsed: payload.marginUsed || 0,
      unrealizedPnL: 0,
      realizedPnL: 0,
      status: event.newStatus || 'PENDING',
      stopLoss: payload.stopLoss,
      takeProfit: payload.takeProfit,
      openedAt: payload.openedAt || event.createdAt,
      closedAt: null,
      closeReason: null,
      createdAt: event.createdAt,
      updatedAt: event.createdAt
    } as Position;
  }

  /**
   * Apply event to position state
   */
  private applyEventToPosition(
    position: Position,
    event: PositionEvent,
    skipMissing: boolean
  ): Position {
    const payload = event.payload || {};

    // Update status if changed
    if (event.newStatus) {
      position.status = event.newStatus;
    }

    // Apply event-specific changes
    switch (event.eventType) {
      case PositionEventType.ORDER_FILLED:
      case PositionEventType.PARTIAL_FILL:
        // Update size and average entry price
        if (payload.filledSize) {
          const totalSize = position.size + payload.filledSize;
          const totalCost = (position.size * position.avgEntryPrice) + (payload.filledSize * payload.filledPrice);
          position.avgEntryPrice = totalCost / totalSize;
          position.size = totalSize;
        }
        break;

      case PositionEventType.POSITION_OPENED:
        position.openedAt = payload.openedAt || event.createdAt;
        break;

      case PositionEventType.POSITION_CLOSED:
        position.closedAt = payload.closedAt || event.createdAt;
        position.closeReason = payload.closeReason;
        position.realizedPnL = payload.realizedPnL || position.realizedPnL;
        position.size = 0;
        break;

      case PositionEventType.POSITION_LIQUIDATED:
        position.closedAt = payload.closedAt || event.createdAt;
        position.closeReason = 'LIQUIDATION';
        position.realizedPnL = payload.realizedPnL || position.realizedPnL;
        position.size = 0;
        break;

      case PositionEventType.POSITION_UPDATED:
        // Update any fields provided in payload
        if (payload.stopLoss !== undefined) position.stopLoss = payload.stopLoss;
        if (payload.takeProfit !== undefined) position.takeProfit = payload.takeProfit;
        if (payload.unrealizedPnL !== undefined) position.unrealizedPnL = payload.unrealizedPnL;
        break;
    }

    position.updatedAt = event.createdAt;
    return position;
  }

  /**
   * Rebuild account balances from position data
   */
  private async rebuildAccountBalances(): Promise<void> {
    console.log('[EventReplay] Rebuilding account balances...');

    const accounts = await this.positionRepository.findAllAccounts();

    for (const accountId of accounts) {
      const positions = await this.positionRepository.findByAccountId(accountId);

      // Calculate totals
      const openPositions = positions.filter((p: any) => p.status === 'OPEN');
      const totalMarginUsed = openPositions.reduce((sum: number, p: any) => sum + p.marginUsed, 0);
      const totalUnrealizedPnL = openPositions.reduce((sum: number, p: any) => sum + p.unrealizedPnL, 0);
      const totalRealizedPnL = positions.reduce((sum: number, p: any) => sum + p.realizedPnL, 0);

      // Get account
      const account = await this.positionRepository.findAccountById(accountId);
      if (!account) continue;

      // Update account
      const updatedAccount = {
        ...account,
        marginUsed: totalMarginUsed,
        equity: account.balance + totalUnrealizedPnL,
        freeMargin: account.balance + totalUnrealizedPnL - totalMarginUsed,
        updatedAt: new Date()
      };

      await this.positionRepository.updateAccount(accountId, updatedAccount);
    }

    console.log('[EventReplay] Account balances rebuilt');
  }
}
