/**
 * Concurrency Safety Property Tests
 * 
 * Property-based tests for concurrency safety and race condition prevention:
 * - Property 10: Concurrency Safety and Race Condition Prevention
 * 
 * Requirements: 2.4, 4.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { ConcurrencyManagerService } from '../services/concurrency-manager.service';

describe('🧪 Concurrency Safety Property Tests', () => {
  let concurrencyManager: ConcurrencyManagerService;

  beforeEach(() => {
    concurrencyManager = new ConcurrencyManagerService(2000, 10000, 500);
  });

  afterEach(() => {
    concurrencyManager.shutdown();
  });

  describe('🧪 PROPERTY-BASED TESTS', () => {
    it('Property 10: Concurrency Safety and Race Condition Prevention', async () => {
      /**
       * **Feature: test-failure-remediation, Property 10: Concurrency Safety and Race Condition Prevention**
       * **Validates: Requirements 2.4, 4.2**
       */
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            resourceCount: fc.integer({ min: 1, max: 3 }),
            operationCount: fc.integer({ min: 2, max: 6 }),
            lockTypes: fc.array(fc.constantFrom('READ', 'WRITE', 'EXCLUSIVE'), { minLength: 2, maxLength: 6 }),
            ownerCount: fc.integer({ min: 1, max: 3 })
          }),
          async (scenario) => {
            const resources = Array.from({ length: scenario.resourceCount }, (_, i) => `resource-${i}`);
            const owners = Array.from({ length: scenario.ownerCount }, (_, i) => `owner-${i}`);
            
            const operations: Promise<any>[] = [];
            const results: any[] = [];
            const errors: any[] = [];

            // Generate concurrent operations
            for (let i = 0; i < scenario.operationCount; i++) {
              const resourceId = resources[i % resources.length];
              const ownerId = owners[i % owners.length];
              const lockType = scenario.lockTypes[i % scenario.lockTypes.length] as 'READ' | 'WRITE' | 'EXCLUSIVE';

              const operation = concurrencyManager.executeWithLock(
                resourceId,
                lockType,
                async () => {
                  await new Promise(resolve => setTimeout(resolve, 10)); // Short delay
                  return { resourceId, ownerId, lockType, timestamp: new Date() };
                },
                ownerId,
                1000 // Short timeout
              ).then(result => {
                results.push(result);
                return result;
              }).catch(error => {
                errors.push({ error: error.message, resourceId, ownerId, lockType });
                return null;
              });

              operations.push(operation);
            }

            // Wait for all operations to complete
            await Promise.all(operations);

            // Validate concurrency safety properties
            
            // Property 1: No resource should be locked after all operations complete
            for (const resourceId of resources) {
              expect(concurrencyManager.isResourceLocked(resourceId)).toBe(false);
            }

            // Property 2: All operations should have completed (success or error)
            const successfulOps = results.filter(r => r !== null);
            expect(successfulOps.length + errors.length).toBe(scenario.operationCount);

            // Property 3: Lock statistics should be consistent
            const stats = concurrencyManager.getConcurrencyStats();
            expect(stats.activeLocks).toBe(0);

            // Property 4: No owner should have remaining locks
            for (const ownerId of owners) {
              const ownerLocks = concurrencyManager.getOwnerLocks(ownerId);
              expect(ownerLocks).toHaveLength(0);
            }

            return true;
          }
        ),
        { numRuns: 8, timeout: 8000 }
      );
    });

    it('Property 10.1: Lock Compatibility Rules', async () => {
      /**
       * **Feature: test-failure-remediation, Property 10.1: Lock Compatibility Rules**
       * **Validates: Requirements 2.4**
       */
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            resourceId: fc.string({ minLength: 1, maxLength: 10 }),
            firstLockType: fc.constantFrom('READ', 'WRITE', 'EXCLUSIVE'),
            secondLockType: fc.constantFrom('READ', 'WRITE', 'EXCLUSIVE'),
            owner1: fc.string({ minLength: 1, maxLength: 5 }),
            owner2: fc.string({ minLength: 1, maxLength: 5 })
          }),
          async (scenario) => {
            // Ensure different owners
            if (scenario.owner1 === scenario.owner2) {
              scenario.owner2 = scenario.owner2 + '_2';
            }

            const testManager = new ConcurrencyManagerService(1000, 5000, 500);

            try {
              // Acquire first lock
              const firstLock = await testManager.acquireLock({
                resourceId: scenario.resourceId,
                lockType: scenario.firstLockType as any,
                ownerId: scenario.owner1,
                timeoutMs: 100
              });

              // Try to acquire second lock
              let secondLockAcquired = false;

              try {
                const secondLock = await testManager.acquireLock({
                  resourceId: scenario.resourceId,
                  lockType: scenario.secondLockType as any,
                  ownerId: scenario.owner2,
                  timeoutMs: 100
                });
                secondLockAcquired = true;
                await testManager.releaseLock(secondLock.id);
              } catch (error) {
                // Expected for incompatible locks
              }

              // Validate compatibility rules
              const shouldBeCompatible = (
                scenario.firstLockType === 'READ' && scenario.secondLockType === 'READ'
              );

              expect(secondLockAcquired).toBe(shouldBeCompatible);

              await testManager.releaseLock(firstLock.id);
            } finally {
              testManager.shutdown();
            }

            return true;
          }
        ),
        { numRuns: 6, timeout: 5000 }
      );
    });

    it('Property 10.2: Race Condition Detection Accuracy', () => {
      /**
       * **Feature: test-failure-remediation, Property 10.2: Race Condition Detection Accuracy**
       * **Validates: Requirements 2.4, 4.2**
       */
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              resourceId: fc.string({ minLength: 1, maxLength: 5 }),
              operationType: fc.constantFrom('read', 'write'),
              ownerId: fc.string({ minLength: 1, maxLength: 5 }),
              timestampOffset: fc.integer({ min: 0, max: 500 })
            }),
            { minLength: 2, maxLength: 6 }
          ),
          (operations) => {
            const baseTime = Date.now();
            const operationsWithTimestamps = operations.map(op => ({
              resourceId: op.resourceId,
              operationType: op.operationType === 'read' ? 'READ' : 'write' as 'READ' | 'write',
              ownerId: op.ownerId,
              timestamp: new Date(baseTime + op.timestampOffset)
            }));

            const hasRaceCondition = concurrencyManager.detectRaceCondition(operationsWithTimestamps);

            // Analyze expected result
            const resourceGroups = new Map<string, typeof operationsWithTimestamps>();
            for (const op of operationsWithTimestamps) {
              if (!resourceGroups.has(op.resourceId)) {
                resourceGroups.set(op.resourceId, []);
              }
              resourceGroups.get(op.resourceId)!.push(op);
            }

            let shouldHaveRaceCondition = false;
            for (const [, resourceOps] of resourceGroups) {
              const writeOps = resourceOps.filter(op => op.operationType === 'write');
              if (writeOps.length > 1) {
                // Check if any write operations are within 100ms of each other
                writeOps.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                for (let i = 0; i < writeOps.length - 1; i++) {
                  const timeDiff = writeOps[i + 1].timestamp.getTime() - writeOps[i].timestamp.getTime();
                  if (timeDiff < 100) {
                    shouldHaveRaceCondition = true;
                    break;
                  }
                }
              }
            }

            expect(hasRaceCondition).toBe(shouldHaveRaceCondition);
            return true;
          }
        ),
        { numRuns: 8 }
      );
    });

    it('Simple test', () => {
      expect(true).toBe(true);
    });
  });
});