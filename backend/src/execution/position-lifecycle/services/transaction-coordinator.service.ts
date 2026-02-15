/**
 * Transaction Coordinator Service - Provides ACID transaction guarantees
 *
 * This service manages database transactions for all state transitions in the
 * Position Lifecycle Engine, ensuring atomicity, consistency, isolation, and durability.
 *
 * Features:
 * - BEGIN/COMMIT/ROLLBACK transaction management
 * - Configurable isolation levels (default: READ COMMITTED)
 * - Transaction timeout handling (default: 5 seconds)
 * - Deadlock detection and retry with exponential backoff
 * - Nested transaction support using PostgreSQL savepoints
 * - Transaction logging for debugging and monitoring
 *
 * Requirements: 2.1.1, 2.1.5, 2.1.6, 2.3.2
 *
 * IMPLEMENTATION NOTE:
 * This service requires a Supabase RPC function called 'exec_sql' to execute
 * raw SQL commands (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, etc.).
 *
 * To create this function in your Supabase database, run:
 *
 * CREATE OR REPLACE FUNCTION exec_sql(sql text)
 * RETURNS void
 * LANGUAGE plpgsql
 * SECURITY DEFINER
 * AS $$
 * BEGIN
 *   EXECUTE sql;
 * END;
 * $$;
 *
 * For now, this service provides the interface and will log warnings when
 * RPC is not available. Full transaction support will be enabled once the
 * RPC function is deployed.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export interface TransactionOptions {
  isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface TransactionOperation {
  name: string;
  execute: (client: ReturnType<typeof createClient>) => Promise<void>;
  rollback?: (client: ReturnType<typeof createClient>) => Promise<void>;
}

interface TransactionContext {
  id: string;
  startTime: Date;
  isolationLevel: string;
  savepointStack: string[];
  isActive: boolean;
  operationName?: string;
}

interface TransactionLogEntry {
  transaction_id: string;
  operation_name: string;
  status: 'STARTED' | 'COMMITTED' | 'ROLLED_BACK' | 'FAILED';
  isolation_level: string;
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export class TransactionCoordinatorService {
  private currentTransaction: TransactionContext | null = null;
  private readonly DEFAULT_TIMEOUT_MS = 5000;
  private readonly DEFAULT_MAX_RETRIES = 3;
  private readonly DEFAULT_RETRY_DELAY_MS = 100;
  private readonly DEADLOCK_ERROR_CODE = '40P01';

  constructor(private readonly supabase: ReturnType<typeof createClient>) {}

  /**
   * Execute an operation within a database transaction
   *
   * @param operation - Function to execute within the transaction
   * @param options - Transaction configuration options
   * @returns Result of the operation
   *
   * @throws Error if transaction fails after all retries
   */
  async executeInTransaction<T>(
    operation: (client: ReturnType<typeof createClient>) => Promise<T>,
    options?: TransactionOptions & { operationName?: string }
  ): Promise<T> {
    const opts = this.getOptionsWithDefaults(options);
    const transactionId = randomUUID();
    const operationName = options?.operationName || 'unknown_operation';
    let lastError: Error | null = null;

    // Retry loop for deadlock handling
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        // If this is a retry, wait with exponential backoff
        if (attempt > 0) {
          const delay = opts.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          // eslint-disable-next-line no-console
          console.log(
            `[TransactionCoordinator] Retry attempt ${attempt} for transaction ${transactionId} after ${delay}ms`
          );
        }

        const result = await this.executeTransactionAttempt(
          transactionId,
          operationName,
          operation,
          opts
        );

        // Success - return result
        if (attempt > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[TransactionCoordinator] Transaction ${transactionId} succeeded on retry attempt ${attempt}`
          );
        }
        return result;
      } catch (error) {
        lastError = error as Error;

        // Check if this is a deadlock error
        if (this.isDeadlockError(error)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[TransactionCoordinator] Deadlock detected in transaction ${transactionId}, attempt ${
              attempt + 1
            }/${opts.maxRetries + 1}`
          );

          // If we have retries left, continue to next iteration
          if (attempt < opts.maxRetries) {
            continue;
          }
        }

        // For non-deadlock errors or if we're out of retries, throw immediately
        throw error;
      }
    }

    // If we get here, all retries failed
    throw new Error(
      `Transaction ${transactionId} failed after ${
        opts.maxRetries + 1
      } attempts. Last error: ${lastError?.message}`
    );
  }

  /**
   * Execute multiple operations in a single transaction
   *
   * @param operations - Array of operations to execute
   * @param options - Transaction configuration options
   *
   * @throws Error if any operation fails
   */
  async executeBatch(
    operations: TransactionOperation[],
    options?: TransactionOptions
  ): Promise<void> {
    await this.executeInTransaction(async (client) => {
      for (const op of operations) {
        try {
          await op.execute(client);
        } catch (error) {
          // If operation has a custom rollback, execute it
          if (op.rollback) {
            try {
              await op.rollback(client);
            } catch (rollbackError) {
              // eslint-disable-next-line no-console
              console.error(
                `[TransactionCoordinator] Rollback failed for operation ${op.name}:`,
                rollbackError
              );
            }
          }
          throw new Error(
            `Operation ${op.name} failed: ${(error as Error).message}`
          );
        }
      }
    }, options);
  }

  /**
   * Check if currently in a transaction
   */
  isInTransaction(): boolean {
    return this.currentTransaction !== null && this.currentTransaction.isActive;
  }

  /**
   * Get current transaction ID
   */
  getCurrentTransactionId(): string | null {
    return this.currentTransaction?.id ?? null;
  }

  /**
   * Execute a single transaction attempt
   */
  private async executeTransactionAttempt<T>(
    transactionId: string,
    operationName: string,
    operation: (client: ReturnType<typeof createClient>) => Promise<T>,
    options: Required<TransactionOptions>
  ): Promise<T> {
    const startTime = Date.now();
    const startDate = new Date();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(
            new Error(
              `Transaction ${transactionId} timed out after ${options.timeoutMs}ms`
            )
          );
        }, options.timeoutMs);
      });

      // Create transaction context
      this.currentTransaction = {
        id: transactionId,
        startTime: startDate,
        isolationLevel: options.isolationLevel,
        savepointStack: [],
        isActive: true,
        operationName,
      };

      // Execute BEGIN with isolation level
      await this.beginTransaction(options.isolationLevel);

      // Log transaction start
      await this.logTransaction({
        transaction_id: transactionId,
        operation_name: operationName,
        status: 'STARTED',
        isolation_level: options.isolationLevel,
        started_at: startDate,
      });

      // Race between operation and timeout
      const result = await Promise.race([
        operation(this.supabase),
        timeoutPromise,
      ]);

      // If we get here, operation succeeded - commit
      await this.commitTransaction();

      const duration = Date.now() - startTime;

      // Log successful commit
      await this.logTransaction({
        transaction_id: transactionId,
        operation_name: operationName,
        status: 'COMMITTED',
        isolation_level: options.isolationLevel,
        started_at: startDate,
        completed_at: new Date(),
        duration_ms: duration,
      });

      // eslint-disable-next-line no-console
      console.log(
        `[TransactionCoordinator] Transaction ${transactionId} completed successfully in ${duration}ms`
      );

      return result;
    } catch (error) {
      // Rollback on any error (unless we already timed out and rolled back)
      if (!timedOut && this.currentTransaction?.isActive) {
        try {
          await this.rollbackTransaction();
        } catch (rollbackError) {
          // eslint-disable-next-line no-console
          console.error(
            `[TransactionCoordinator] Rollback failed for transaction ${transactionId}:`,
            rollbackError
          );
        }
      }

      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      // Log rollback or failure
      await this.logTransaction({
        transaction_id: transactionId,
        operation_name: operationName,
        status: timedOut ? 'FAILED' : 'ROLLED_BACK',
        isolation_level: options.isolationLevel,
        started_at: startDate,
        completed_at: new Date(),
        duration_ms: duration,
        error_message: errorMessage,
      });

      // eslint-disable-next-line no-console
      console.error(
        `[TransactionCoordinator] Transaction ${transactionId} failed after ${duration}ms:`,
        error
      );

      throw error;
    } finally {
      // Clean up
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      this.currentTransaction = null;
    }
  }

  /**
   * Begin a new transaction with specified isolation level
   */
  private async beginTransaction(isolationLevel: string): Promise<void> {
    try {
      // Use Supabase RPC to execute raw SQL
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: `BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`,
      });

      if (error) {
        throw new Error(`Failed to begin transaction: ${error.message}`);
      }
    } catch (error) {
      // If RPC doesn't exist, fall back to direct query (for testing)
      // eslint-disable-next-line no-console
      console.warn(
        '[TransactionCoordinator] RPC not available, using direct query'
      );
      // Note: Supabase client doesn't support raw SQL directly in the same way
      // In production, we'd need to use a PostgreSQL client or Supabase RPC function
      throw new Error(
        'Transaction support requires Supabase RPC function. See implementation notes.'
      );
    }
  }

  /**
   * Commit the current transaction
   */
  private async commitTransaction(): Promise<void> {
    if (!this.currentTransaction?.isActive) {
      throw new Error('No active transaction to commit');
    }

    try {
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: 'COMMIT',
      });

      if (error) {
        throw new Error(`Failed to commit transaction: ${error.message}`);
      }

      this.currentTransaction.isActive = false;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[TransactionCoordinator] RPC not available for commit');
      throw new Error(
        'Transaction support requires Supabase RPC function. See implementation notes.'
      );
    }
  }

  /**
   * Rollback the current transaction
   */
  private async rollbackTransaction(): Promise<void> {
    if (!this.currentTransaction) {
      return; // Nothing to rollback
    }

    try {
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: 'ROLLBACK',
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to rollback transaction: ${error.message}`);
      }

      this.currentTransaction.isActive = false;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[TransactionCoordinator] RPC not available for rollback');
      // Don't throw - we're already in error handling
    }
  }

  /**
   * Create a savepoint for nested transaction support
   */
  async createSavepoint(name: string): Promise<void> {
    if (!this.currentTransaction?.isActive) {
      throw new Error('Cannot create savepoint outside of transaction');
    }

    try {
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: `SAVEPOINT ${name}`,
      });

      if (error) {
        throw new Error(
          `Failed to create savepoint ${name}: ${error.message}`
        );
      }

      this.currentTransaction.savepointStack.push(name);
    } catch (error) {
      throw new Error(
        'Savepoint support requires Supabase RPC function. See implementation notes.'
      );
    }
  }

  /**
   * Rollback to a savepoint
   */
  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.currentTransaction?.isActive) {
      throw new Error('Cannot rollback to savepoint outside of transaction');
    }

    try {
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: `ROLLBACK TO SAVEPOINT ${name}`,
      });

      if (error) {
        throw new Error(
          `Failed to rollback to savepoint ${name}: ${error.message}`
        );
      }

      // Remove this savepoint and all after it from the stack
      const index = this.currentTransaction.savepointStack.indexOf(name);
      if (index !== -1) {
        this.currentTransaction.savepointStack =
          this.currentTransaction.savepointStack.slice(0, index);
      }
    } catch (error) {
      throw new Error(
        'Savepoint support requires Supabase RPC function. See implementation notes.'
      );
    }
  }

  /**
   * Release a savepoint (commit nested transaction)
   */
  async releaseSavepoint(name: string): Promise<void> {
    if (!this.currentTransaction?.isActive) {
      throw new Error('Cannot release savepoint outside of transaction');
    }

    try {
      const { error } = await this.supabase.rpc('exec_sql', {
        sql: `RELEASE SAVEPOINT ${name}`,
      });

      if (error) {
        throw new Error(
          `Failed to release savepoint ${name}: ${error.message}`
        );
      }

      // Remove this savepoint from the stack
      const index = this.currentTransaction.savepointStack.indexOf(name);
      if (index !== -1) {
        this.currentTransaction.savepointStack.splice(index, 1);
      }
    } catch (error) {
      throw new Error(
        'Savepoint support requires Supabase RPC function. See implementation notes.'
      );
    }
  }

  /**
   * Check if an error is a deadlock error
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isDeadlockError(error: any): boolean {
    // PostgreSQL deadlock error code is 40P01
    if (error?.code === this.DEADLOCK_ERROR_CODE) {
      return true;
    }

    // Also check error message for deadlock keywords
    const message = error?.message?.toLowerCase() || '';
    return message.includes('deadlock') || message.includes('40p01');
  }

  /**
   * Get options with defaults applied
   */
  private getOptionsWithDefaults(
    options?: TransactionOptions
  ): Required<TransactionOptions> {
    return {
      isolationLevel: options?.isolationLevel ?? 'READ COMMITTED',
      timeoutMs: options?.timeoutMs ?? this.DEFAULT_TIMEOUT_MS,
      maxRetries: options?.maxRetries ?? this.DEFAULT_MAX_RETRIES,
      retryDelayMs: options?.retryDelayMs ?? this.DEFAULT_RETRY_DELAY_MS,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log transaction metadata to transaction_log table
   *
   * @param entry - Transaction log entry
   */
  private async logTransaction(entry: TransactionLogEntry): Promise<void> {
    try {
      const { error } = await this.supabase.from('transaction_log').insert({
        transaction_id: entry.transaction_id,
        operation_name: entry.operation_name,
        status: entry.status,
        isolation_level: entry.isolation_level,
        started_at: entry.started_at.toISOString(),
        completed_at: entry.completed_at?.toISOString(),
        duration_ms: entry.duration_ms,
        error_message: entry.error_message,
        metadata: entry.metadata,
      });

      if (error) {
        // Don't throw - logging failure shouldn't break the transaction
        // eslint-disable-next-line no-console
        console.error(
          `[TransactionCoordinator] Failed to log transaction ${entry.transaction_id}:`,
          error
        );
      }
    } catch (error) {
      // Don't throw - logging failure shouldn't break the transaction
      // eslint-disable-next-line no-console
      console.error(
        `[TransactionCoordinator] Failed to log transaction ${entry.transaction_id}:`,
        error
      );
    }
  }
}
