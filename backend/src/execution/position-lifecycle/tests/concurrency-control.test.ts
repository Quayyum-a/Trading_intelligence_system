/**
 * Concurrency Control Tests
 * 
 * Tests the concurrency control and race condition prevention with:
 * - Distributed locking for resource conflict prevention
 * - Resource conflict detection and resolution
 * - Optimistic locking for position updates
 * 
 * Requirements: 2.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConcurrencyManagerService } from '../services/concurrency-manager.service';

describe('Concurrency Control', () => {
  let concurrencyManager: ConcurrencyManagerService;

  beforeEach(() => {
    concurrencyManager = new ConcurrencyManagerService(5000, 30000, 1000); // Short timeouts for testing
  });

  afterEach(() => {
    concurrencyManager.shutdown();
  });

  describe('Lock Management', () => {
    describe('Basic Lock Operations', () => {
      it('should acquire and release locks successfully', async () => {
        const lock = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'WRITE',
          ownerId: 'owner-1'
        });

        expect(lock).toBeDefined();
        expect(lock.resourceId).toBe('resource-1');
        expect(lock.lockType).toBe('WRITE');
        expect(lock.ownerId).toBe('owner-1');

        // Check that resource is locked
        expect(concurrencyManager.isResourceLocked('resource-1')).toBe(true);

        // Release lock
        await concurrencyManager.releaseLock(lock.id);

        // Check that resource is no longer locked
        expect(concurrencyManager.isResourceLocked('resource-1')).toBe(false);
      });

      it('should allow multiple READ locks on same resource', async () => {
        const lock1 = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-1'
        });

        const lock2 = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-2'
        });

        expect(lock1).toBeDefined();
        expect(lock2).toBeDefined();

        const resourceLocks = concurrencyManager.getResourceLocks('resource-1');
        expect(resourceLocks).toHaveLength(2);

        await concurrencyManager.releaseLock(lock1.id);
        await concurrencyManager.releaseLock(lock2.id);
      });

      it('should prevent WRITE lock when READ lock exists', async () => {
        const readLock = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-1'
        });

        // Try to acquire WRITE lock - should timeout
        const writePromise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'WRITE',
          ownerId: 'owner-2',
          timeoutMs: 100
        });

        await expect(writePromise).rejects.toThrow('timeout');

        await concurrencyManager.releaseLock(readLock.id);
      });

      it('should prevent READ lock when WRITE lock exists', async () => {
        const writeLock = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'WRITE',
          ownerId: 'owner-1'
        });

        // Try to acquire READ lock - should timeout
        const readPromise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-2',
          timeoutMs: 100
        });

        await expect(readPromise).rejects.toThrow('timeout');

        await concurrencyManager.releaseLock(writeLock.id);
      });

      it('should prevent any lock when EXCLUSIVE lock exists', async () => {
        const exclusiveLock = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'EXCLUSIVE',
          ownerId: 'owner-1'
        });

        // Try to acquire READ lock - should timeout
        const readPromise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-2',
          timeoutMs: 100
        });

        await expect(readPromise).rejects.toThrow('timeout');

        // Try to acquire WRITE lock - should timeout
        const writePromise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'WRITE',
          ownerId: 'owner-3',
          timeoutMs: 100
        });

        await expect(writePromise).rejects.toThrow('timeout');

        await concurrencyManager.releaseLock(exclusiveLock.id);
      });
    });

    describe('Lock Queuing', () => {
      it('should queue lock requests and process them in order', async () => {
        // Acquire initial WRITE lock
        const initialLock = await concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'WRITE',
          ownerId: 'owner-1'
        });

        // Queue multiple lock requests
        const lock2Promise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-2',
          timeoutMs: 2000
        });

        const lock3Promise = concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-3',
          timeoutMs: 2000
        });

        // Release initial lock
        await concurrencyManager.releaseLock(initialLock.id);

        // Both queued locks should be granted
        const [lock2, lock3] = await Promise.all([lock2Promise, lock3Promise]);

        expect(lock2).toBeDefined();
        expect(lock3).toBeDefined();

        await concurrencyManager.releaseLock(lock2.id);
        await concurrencyManager.releaseLock(lock3.id);
      });
    });

    describe('Execute with Lock', () => {
      it('should execute operation with automatic lock management', async () => {
        let operationExecuted = false;

        const result = await concurrencyManager.executeWithLock(
          'resource-1',
          'WRITE',
          async () => {
            operationExecuted = true;
            return 'success';
          },
          'owner-1'
        );

        expect(result).toBe('success');
        expect(operationExecuted).toBe(true);
        expect(concurrencyManager.isResourceLocked('resource-1')).toBe(false);
      });

      it('should release lock even if operation throws', async () => {
        await expect(
          concurrencyManager.executeWithLock(
            'resource-1',
            'WRITE',
            async () => {
              throw new Error('Operation failed');
            },
            'owner-1'
          )
        ).rejects.toThrow('Operation failed');

        expect(concurrencyManager.isResourceLocked('resource-1')).toBe(false);
      });
    });
  });

  describe('Race Condition Detection', () => {
    it('should detect race conditions in concurrent write operations', () => {
      const operations = [
        {
          resourceId: 'resource-1',
          operationType: 'write' as const,
          ownerId: 'owner-1',
          timestamp: new Date()
        },
        {
          resourceId: 'resource-1',
          operationType: 'write' as const,
          ownerId: 'owner-2',
          timestamp: new Date(Date.now() + 50) // 50ms later
        }
      ];

      const hasRaceCondition = concurrencyManager.detectRaceCondition(operations);
      expect(hasRaceCondition).toBe(true);
    });

    it('should not detect race conditions in sequential operations', () => {
      const operations = [
        {
          resourceId: 'resource-1',
          operationType: 'write' as const,
          ownerId: 'owner-1',
          timestamp: new Date()
        },
        {
          resourceId: 'resource-1',
          operationType: 'write' as const,
          ownerId: 'owner-2',
          timestamp: new Date(Date.now() + 200) // 200ms later
        }
      ];

      const hasRaceCondition = concurrencyManager.detectRaceCondition(operations);
      expect(hasRaceCondition).toBe(false);
    });

    it('should not detect race conditions in concurrent read operations', () => {
      const operations = [
        {
          resourceId: 'resource-1',
          operationType: 'read' as const,
          ownerId: 'owner-1',
          timestamp: new Date()
        },
        {
          resourceId: 'resource-1',
          operationType: 'read' as const,
          ownerId: 'owner-2',
          timestamp: new Date(Date.now() + 50)
        }
      ];

      const hasRaceCondition = concurrencyManager.detectRaceCondition(operations);
      expect(hasRaceCondition).toBe(false);
    });
  });

  describe('Lock Statistics and Monitoring', () => {
    it('should track lock statistics', async () => {
      const initialStats = concurrencyManager.getConcurrencyStats();
      expect(initialStats.activeLocks).toBe(0);
      expect(initialStats.totalLocksAcquired).toBe(0);

      const lock = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-1'
      });

      const activeStats = concurrencyManager.getConcurrencyStats();
      expect(activeStats.activeLocks).toBe(1);
      expect(activeStats.totalLocksAcquired).toBe(1);

      await concurrencyManager.releaseLock(lock.id);

      const finalStats = concurrencyManager.getConcurrencyStats();
      expect(finalStats.activeLocks).toBe(0);
      expect(finalStats.totalLocksReleased).toBe(1);
    });

    it('should provide resource lock information', async () => {
      const lock1 = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'READ',
        ownerId: 'owner-1'
      });

      const lock2 = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'READ',
        ownerId: 'owner-2'
      });

      const resourceLocks = concurrencyManager.getResourceLocks('resource-1');
      expect(resourceLocks).toHaveLength(2);
      expect(resourceLocks.map(l => l.ownerId)).toContain('owner-1');
      expect(resourceLocks.map(l => l.ownerId)).toContain('owner-2');

      await concurrencyManager.releaseLock(lock1.id);
      await concurrencyManager.releaseLock(lock2.id);
    });

    it('should provide owner lock information', async () => {
      const lock1 = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-1'
      });

      const lock2 = await concurrencyManager.acquireLock({
        resourceId: 'resource-2',
        lockType: 'READ',
        ownerId: 'owner-1'
      });

      const ownerLocks = concurrencyManager.getOwnerLocks('owner-1');
      expect(ownerLocks).toHaveLength(2);
      expect(ownerLocks.map(l => l.resourceId)).toContain('resource-1');
      expect(ownerLocks.map(l => l.resourceId)).toContain('resource-2');

      await concurrencyManager.releaseLock(lock1.id);
      await concurrencyManager.releaseLock(lock2.id);
    });
  });

  describe('Lock Cleanup and Management', () => {
    it('should force release all locks for an owner', async () => {
      const lock1 = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-1'
      });

      const lock2 = await concurrencyManager.acquireLock({
        resourceId: 'resource-2',
        lockType: 'READ',
        ownerId: 'owner-1'
      });

      expect(concurrencyManager.getOwnerLocks('owner-1')).toHaveLength(2);

      const releasedCount = await concurrencyManager.forceReleaseOwnerLocks('owner-1');
      expect(releasedCount).toBe(2);
      expect(concurrencyManager.getOwnerLocks('owner-1')).toHaveLength(0);
    });

    it('should clean up expired locks', async () => {
      // Create manager with very short lock hold time for testing
      const shortLockManager = new ConcurrencyManagerService(5000, 100, 1000); // 100ms max hold time

      const lock = await shortLockManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-1'
      });

      expect(shortLockManager.isResourceLocked('resource-1')).toBe(true);

      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const cleanedCount = shortLockManager.cleanupExpiredLocks();
      expect(cleanedCount).toBe(1);
      expect(shortLockManager.isResourceLocked('resource-1')).toBe(false);

      shortLockManager.shutdown();
    });
  });

  describe('Deadlock Detection and Resolution', () => {
    it('should handle simple deadlock scenarios', async () => {
      // This test simulates a potential deadlock scenario
      // In practice, deadlock detection runs periodically
      
      const lock1 = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-1'
      });

      const lock2 = await concurrencyManager.acquireLock({
        resourceId: 'resource-2',
        lockType: 'WRITE',
        ownerId: 'owner-2'
      });

      // Now each owner tries to acquire the other's resource
      // This would create a deadlock in a real scenario
      const deadlockPromise1 = concurrencyManager.acquireLock({
        resourceId: 'resource-2',
        lockType: 'WRITE',
        ownerId: 'owner-1',
        timeoutMs: 500
      });

      const deadlockPromise2 = concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'WRITE',
        ownerId: 'owner-2',
        timeoutMs: 500
      });

      // Both should timeout (deadlock prevention)
      await expect(deadlockPromise1).rejects.toThrow('timeout');
      await expect(deadlockPromise2).rejects.toThrow('timeout');

      await concurrencyManager.releaseLock(lock1.id);
      await concurrencyManager.releaseLock(lock2.id);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle high concurrency correctly', async () => {
      const concurrentOperations = 50;
      const promises: Promise<any>[] = [];

      // Create many concurrent lock requests
      for (let i = 0; i < concurrentOperations; i++) {
        const promise = concurrencyManager.executeWithLock(
          'shared-resource',
          'READ',
          async () => {
            // Simulate some work
            await new Promise(resolve => setTimeout(resolve, 10));
            return i;
          },
          `owner-${i}`
        );
        promises.push(promise);
      }

      // All operations should complete successfully
      const results = await Promise.all(promises);
      expect(results).toHaveLength(concurrentOperations);

      // Resource should be unlocked after all operations
      expect(concurrencyManager.isResourceLocked('shared-resource')).toBe(false);
    });

    it('should serialize write operations correctly', async () => {
      const writeOperations = 10;
      const results: number[] = [];
      const promises: Promise<void>[] = [];

      // Create concurrent write operations
      for (let i = 0; i < writeOperations; i++) {
        const promise = concurrencyManager.executeWithLock(
          'shared-resource',
          'WRITE',
          async () => {
            results.push(i);
            await new Promise(resolve => setTimeout(resolve, 10));
          },
          `owner-${i}`
        );
        promises.push(promise);
      }

      await Promise.all(promises);

      // All operations should have completed
      expect(results).toHaveLength(writeOperations);
      expect(concurrencyManager.isResourceLocked('shared-resource')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid lock release', async () => {
      await expect(
        concurrencyManager.releaseLock('non-existent-lock')
      ).rejects.toThrow('Lock non-existent-lock not found');
    });

    it('should handle lock timeout gracefully', async () => {
      const lock = await concurrencyManager.acquireLock({
        resourceId: 'resource-1',
        lockType: 'EXCLUSIVE',
        ownerId: 'owner-1'
      });

      // Try to acquire conflicting lock with short timeout
      await expect(
        concurrencyManager.acquireLock({
          resourceId: 'resource-1',
          lockType: 'READ',
          ownerId: 'owner-2',
          timeoutMs: 100
        })
      ).rejects.toThrow('timeout');

      await concurrencyManager.releaseLock(lock.id);
    });
  });
});