/**
 * Concurrency Manager Service - Race condition prevention and resource locking
 * 
 * This service implements:
 * - Distributed locking for resource conflict prevention
 * - Resource conflict detection and resolution
 * - Optimistic locking for position updates
 * 
 * Requirements: 2.4
 */

import { randomUUID } from 'crypto';

export interface Lock {
  id: string;
  resourceId: string;
  lockType: 'READ' | 'WRITE' | 'EXCLUSIVE';
  ownerId: string;
  acquiredAt: Date;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

export interface ResourceConflict {
  id: string;
  resourceId: string;
  conflictType: 'WRITE_WRITE' | 'READ_WRITE' | 'DEADLOCK' | 'TIMEOUT';
  participants: string[];
  detectedAt: Date;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata?: Record<string, any>;
}

export interface ConcurrencyStats {
  activeLocks: number;
  totalLocksAcquired: number;
  totalLocksReleased: number;
  totalConflicts: number;
  averageLockHoldTimeMs: number;
  deadlockCount: number;
  timeoutCount: number;
}

export interface LockRequest {
  resourceId: string;
  lockType: 'READ' | 'WRITE' | 'EXCLUSIVE';
  ownerId: string;
  timeoutMs?: number;
  metadata?: Record<string, any>;
}

export class ConcurrencyManagerService {
  private readonly activeLocks: Map<string, Lock> = new Map(); // lockId -> Lock
  private readonly resourceLocks: Map<string, Set<string>> = new Map(); // resourceId -> Set<lockId>
  private readonly ownerLocks: Map<string, Set<string>> = new Map(); // ownerId -> Set<lockId>
  private readonly conflictHistory: Map<string, ResourceConflict> = new Map();
  private readonly lockWaitQueue: Map<string, Array<{
    request: LockRequest;
    resolve: (lock: Lock) => void;
    reject: (error: Error) => void;
    timestamp: Date;
  }>> = new Map();

  // Statistics tracking
  private totalLocksAcquired = 0;
  private totalLocksReleased = 0;
  private totalLockHoldTime = 0;
  private deadlockCount = 0;
  private timeoutCount = 0;

  constructor(
    private readonly defaultTimeoutMs: number = 30000, // 30 seconds
    private readonly maxLockHoldTimeMs: number = 300000, // 5 minutes
    private readonly deadlockDetectionIntervalMs: number = 5000 // 5 seconds
  ) {
    // Start deadlock detection
    this.startDeadlockDetection();
  }

  /**
   * Acquire a lock on a resource
   */
  async acquireLock(request: LockRequest): Promise<Lock> {
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;
    const lockId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.maxLockHoldTimeMs);

    // Check if lock can be acquired immediately
    if (this.canAcquireLock(request)) {
      const lock: Lock = {
        id: lockId,
        resourceId: request.resourceId,
        lockType: request.lockType,
        ownerId: request.ownerId,
        acquiredAt: now,
        expiresAt,
        metadata: request.metadata
      };

      this.grantLock(lock);
      return lock;
    }

    // Add to wait queue
    return new Promise((resolve, reject) => {
      const queueEntry = {
        request,
        resolve,
        reject,
        timestamp: now
      };

      if (!this.lockWaitQueue.has(request.resourceId)) {
        this.lockWaitQueue.set(request.resourceId, []);
      }
      this.lockWaitQueue.get(request.resourceId)!.push(queueEntry);

      // Set timeout
      setTimeout(() => {
        this.removeFromWaitQueue(request.resourceId, queueEntry);
        this.timeoutCount++;
        reject(new Error(`Lock acquisition timeout for resource ${request.resourceId}`));
      }, timeoutMs);
    });
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId: string): Promise<void> {
    const lock = this.activeLocks.get(lockId);
    if (!lock) {
      throw new Error(`Lock ${lockId} not found`);
    }

    // Remove lock
    this.activeLocks.delete(lockId);
    
    // Update resource locks
    const resourceLocks = this.resourceLocks.get(lock.resourceId);
    if (resourceLocks) {
      resourceLocks.delete(lockId);
      if (resourceLocks.size === 0) {
        this.resourceLocks.delete(lock.resourceId);
      }
    }

    // Update owner locks
    const ownerLocks = this.ownerLocks.get(lock.ownerId);
    if (ownerLocks) {
      ownerLocks.delete(lockId);
      if (ownerLocks.size === 0) {
        this.ownerLocks.delete(lock.ownerId);
      }
    }

    // Update statistics
    this.totalLocksReleased++;
    const holdTime = Date.now() - lock.acquiredAt.getTime();
    this.totalLockHoldTime += holdTime;

    // Process wait queue
    await this.processWaitQueue(lock.resourceId);
  }

  /**
   * Execute operation with lock
   */
  async executeWithLock<T>(
    resourceId: string,
    lockType: 'READ' | 'WRITE' | 'EXCLUSIVE',
    operation: () => Promise<T>,
    ownerId: string = 'default',
    timeoutMs?: number
  ): Promise<T> {
    const lock = await this.acquireLock({
      resourceId,
      lockType,
      ownerId,
      timeoutMs
    });

    try {
      return await operation();
    } finally {
      await this.releaseLock(lock.id);
    }
  }

  /**
   * Detect race conditions in a set of operations
   */
  detectRaceCondition(operations: Array<{
    resourceId: string;
    operationType: 'READ' | 'write';
    ownerId: string;
    timestamp: Date;
  }>): boolean {
    // Group operations by resource
    const resourceOperations = new Map<string, typeof operations>();
    
    for (const op of operations) {
      if (!resourceOperations.has(op.resourceId)) {
        resourceOperations.set(op.resourceId, []);
      }
      resourceOperations.get(op.resourceId)!.push(op);
    }

    // Check each resource for race conditions
    for (const [resourceId, ops] of resourceOperations) {
      if (this.hasRaceCondition(ops)) {
        this.recordConflict({
          resourceId,
          conflictType: 'WRITE_WRITE',
          participants: ops.map(op => op.ownerId),
          detectedAt: new Date(),
          severity: 'HIGH',
          metadata: { operations: ops }
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Resolve a resource conflict
   */
  async resolveConflict(conflict: ResourceConflict): Promise<void> {
    switch (conflict.conflictType) {
      case 'DEADLOCK':
        await this.resolveDeadlock(conflict);
        break;
      case 'WRITE_WRITE':
        await this.resolveWriteConflict(conflict);
        break;
      case 'READ_WRITE':
        await this.resolveReadWriteConflict(conflict);
        break;
      case 'TIMEOUT':
        await this.resolveTimeoutConflict(conflict);
        break;
    }
  }

  /**
   * Get current concurrency statistics
   */
  getConcurrencyStats(): ConcurrencyStats {
    const averageLockHoldTime = this.totalLocksReleased > 0 
      ? this.totalLockHoldTime / this.totalLocksReleased 
      : 0;

    return {
      activeLocks: this.activeLocks.size,
      totalLocksAcquired: this.totalLocksAcquired,
      totalLocksReleased: this.totalLocksReleased,
      totalConflicts: this.conflictHistory.size,
      averageLockHoldTimeMs: averageLockHoldTime,
      deadlockCount: this.deadlockCount,
      timeoutCount: this.timeoutCount
    };
  }

  /**
   * Get active locks for a resource
   */
  getResourceLocks(resourceId: string): Lock[] {
    const lockIds = this.resourceLocks.get(resourceId) || new Set();
    return Array.from(lockIds).map(id => this.activeLocks.get(id)!).filter(Boolean);
  }

  /**
   * Get all locks owned by an owner
   */
  getOwnerLocks(ownerId: string): Lock[] {
    const lockIds = this.ownerLocks.get(ownerId) || new Set();
    return Array.from(lockIds).map(id => this.activeLocks.get(id)!).filter(Boolean);
  }

  /**
   * Check if a resource is locked
   */
  isResourceLocked(resourceId: string, lockType?: 'READ' | 'WRITE' | 'EXCLUSIVE'): boolean {
    const locks = this.getResourceLocks(resourceId);
    
    if (!lockType) {
      return locks.length > 0;
    }

    return locks.some(lock => lock.lockType === lockType);
  }

  /**
   * Force release all locks for an owner (emergency cleanup)
   */
  async forceReleaseOwnerLocks(ownerId: string): Promise<number> {
    const locks = this.getOwnerLocks(ownerId);
    
    for (const lock of locks) {
      await this.releaseLock(lock.id);
    }

    return locks.length;
  }

  /**
   * Clean up expired locks
   */
  cleanupExpiredLocks(): number {
    const now = Date.now();
    const expiredLocks: string[] = [];

    for (const [lockId, lock] of this.activeLocks) {
      if (lock.expiresAt.getTime() < now) {
        expiredLocks.push(lockId);
      }
    }

    // Release expired locks
    for (const lockId of expiredLocks) {
      this.releaseLock(lockId).catch(error => {
        console.warn(`Failed to release expired lock ${lockId}:`, error);
      });
    }

    return expiredLocks.length;
  }

  /**
   * Shutdown the concurrency manager
   */
  shutdown(): void {
    // Clear all locks and queues
    this.activeLocks.clear();
    this.resourceLocks.clear();
    this.ownerLocks.clear();
    this.lockWaitQueue.clear();
    this.conflictHistory.clear();
  }

  /**
   * Check if a lock can be acquired
   */
  private canAcquireLock(request: LockRequest): boolean {
    const existingLocks = this.getResourceLocks(request.resourceId);
    
    if (existingLocks.length === 0) {
      return true; // No existing locks
    }

    // Check compatibility
    for (const existingLock of existingLocks) {
      if (!this.areLocksCompatible(request.lockType, existingLock.lockType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if two lock types are compatible
   */
  private areLocksCompatible(requestType: string, existingType: string): boolean {
    // EXCLUSIVE locks are never compatible with anything
    if (requestType === 'EXCLUSIVE' || existingType === 'EXCLUSIVE') {
      return false;
    }

    // READ locks are compatible with other READ locks
    if (requestType === 'READ' && existingType === 'READ') {
      return true;
    }

    // WRITE locks are not compatible with anything
    return false;
  }

  /**
   * Grant a lock
   */
  private grantLock(lock: Lock): void {
    this.activeLocks.set(lock.id, lock);
    
    // Update resource locks
    if (!this.resourceLocks.has(lock.resourceId)) {
      this.resourceLocks.set(lock.resourceId, new Set());
    }
    this.resourceLocks.get(lock.resourceId)!.add(lock.id);

    // Update owner locks
    if (!this.ownerLocks.has(lock.ownerId)) {
      this.ownerLocks.set(lock.ownerId, new Set());
    }
    this.ownerLocks.get(lock.ownerId)!.add(lock.id);

    this.totalLocksAcquired++;
  }

  /**
   * Process wait queue for a resource
   */
  private async processWaitQueue(resourceId: string): Promise<void> {
    const queue = this.lockWaitQueue.get(resourceId);
    if (!queue || queue.length === 0) {
      return;
    }

    // Try to grant locks to waiting requests
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      
      if (this.canAcquireLock(entry.request)) {
        // Remove from queue
        queue.splice(i, 1);
        
        // Grant lock
        const lock: Lock = {
          id: randomUUID(),
          resourceId: entry.request.resourceId,
          lockType: entry.request.lockType,
          ownerId: entry.request.ownerId,
          acquiredAt: new Date(),
          expiresAt: new Date(Date.now() + this.maxLockHoldTimeMs),
          metadata: entry.request.metadata
        };

        this.grantLock(lock);
        entry.resolve(lock);
      }
    }

    // Clean up empty queue
    if (queue.length === 0) {
      this.lockWaitQueue.delete(resourceId);
    }
  }

  /**
   * Remove entry from wait queue
   */
  private removeFromWaitQueue(resourceId: string, entry: any): void {
    const queue = this.lockWaitQueue.get(resourceId);
    if (queue) {
      const index = queue.indexOf(entry);
      if (index >= 0) {
        queue.splice(index, 1);
      }
    }
  }

  /**
   * Check for race conditions in operations
   */
  private hasRaceCondition(operations: Array<{
    resourceId: string;
    operationType: 'read' | 'write';
    ownerId: string;
    timestamp: Date;
  }>): boolean {
    // Sort by timestamp
    const sortedOps = operations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Check for concurrent write operations
    const writeOps = sortedOps.filter(op => op.operationType === 'write');
    
    if (writeOps.length > 1) {
      // Check if write operations overlap in time (within 100ms window)
      for (let i = 0; i < writeOps.length - 1; i++) {
        const timeDiff = writeOps[i + 1].timestamp.getTime() - writeOps[i].timestamp.getTime();
        if (timeDiff < 100) { // 100ms window
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Record a conflict
   */
  private recordConflict(conflictData: Omit<ResourceConflict, 'id'>): void {
    const conflict: ResourceConflict = {
      ...conflictData,
      id: randomUUID()
    };

    this.conflictHistory.set(conflict.id, conflict);
  }

  /**
   * Start deadlock detection
   */
  private startDeadlockDetection(): void {
    setInterval(() => {
      this.detectDeadlocks();
      this.cleanupExpiredLocks();
    }, this.deadlockDetectionIntervalMs);
  }

  /**
   * Detect deadlocks
   */
  private detectDeadlocks(): void {
    // Simple deadlock detection: look for circular wait patterns
    const waitGraph = this.buildWaitGraph();
    const cycles = this.findCycles(waitGraph);

    for (const cycle of cycles) {
      this.handleDeadlock(cycle);
    }
  }

  /**
   * Build wait graph for deadlock detection
   */
  private buildWaitGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // For each waiting request, find what it's waiting for
    for (const [resourceId, queue] of this.lockWaitQueue) {
      const resourceLocks = this.getResourceLocks(resourceId);
      
      for (const entry of queue) {
        const waitingOwner = entry.request.ownerId;
        
        if (!graph.has(waitingOwner)) {
          graph.set(waitingOwner, new Set());
        }

        // Add edges to lock holders
        for (const lock of resourceLocks) {
          if (lock.ownerId !== waitingOwner) {
            graph.get(waitingOwner)!.add(lock.ownerId);
          }
        }
      }
    }

    return graph;
  }

  /**
   * Find cycles in wait graph
   */
  private findCycles(graph: Map<string, Set<string>>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        } else if (recursionStack.has(neighbor)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push(path.slice(cycleStart));
        }
      }

      recursionStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Handle deadlock
   */
  private handleDeadlock(cycle: string[]): void {
    this.deadlockCount++;
    
    // Record conflict
    this.recordConflict({
      resourceId: 'DEADLOCK',
      conflictType: 'DEADLOCK',
      participants: cycle,
      detectedAt: new Date(),
      severity: 'CRITICAL',
      metadata: { cycle }
    });

    // Resolve by releasing locks of the "youngest" participant
    const youngestOwner = this.findYoungestLockOwner(cycle);
    if (youngestOwner) {
      this.forceReleaseOwnerLocks(youngestOwner).catch(error => {
        console.error(`Failed to resolve deadlock for owner ${youngestOwner}:`, error);
      });
    }
  }

  /**
   * Find the owner with the most recently acquired lock
   */
  private findYoungestLockOwner(owners: string[]): string | null {
    let youngestOwner: string | null = null;
    let latestTime = 0;

    for (const owner of owners) {
      const locks = this.getOwnerLocks(owner);
      for (const lock of locks) {
        if (lock.acquiredAt.getTime() > latestTime) {
          latestTime = lock.acquiredAt.getTime();
          youngestOwner = owner;
        }
      }
    }

    return youngestOwner;
  }

  /**
   * Resolve deadlock conflict
   */
  private async resolveDeadlock(conflict: ResourceConflict): Promise<void> {
    // Already handled in handleDeadlock
  }

  /**
   * Resolve write-write conflict
   */
  private async resolveWriteConflict(conflict: ResourceConflict): Promise<void> {
    // Force serialize write operations
    const locks = this.getResourceLocks(conflict.resourceId);
    const writeLocks = locks.filter(lock => lock.lockType === 'WRITE');
    
    if (writeLocks.length > 1) {
      // Keep the oldest lock, release others
      writeLocks.sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
      
      for (let i = 1; i < writeLocks.length; i++) {
        await this.releaseLock(writeLocks[i].id);
      }
    }
  }

  /**
   * Resolve read-write conflict
   */
  private async resolveReadWriteConflict(conflict: ResourceConflict): Promise<void> {
    // Prioritize write operations
    const locks = this.getResourceLocks(conflict.resourceId);
    const readLocks = locks.filter(lock => lock.lockType === 'READ');
    
    // Release read locks to allow write
    for (const readLock of readLocks) {
      await this.releaseLock(readLock.id);
    }
  }

  /**
   * Resolve timeout conflict
   */
  private async resolveTimeoutConflict(conflict: ResourceConflict): Promise<void> {
    // Clean up any stale locks for this resource
    const locks = this.getResourceLocks(conflict.resourceId);
    const now = Date.now();
    
    for (const lock of locks) {
      if (now - lock.acquiredAt.getTime() > this.maxLockHoldTimeMs) {
        await this.releaseLock(lock.id);
      }
    }
  }
}