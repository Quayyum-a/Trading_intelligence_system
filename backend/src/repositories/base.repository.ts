import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';
import type { DatabaseError } from '../types/database.js';

export abstract class BaseRepository {
  protected client: SupabaseClient;
  protected logger = getLogger();

  constructor() {
    this.client = getSupabaseClient();
  }

  protected handleDatabaseError(error: unknown, operation: string): never {
    const dbError = new Error(
      `Database operation failed: ${operation}`
    ) as DatabaseError;

    // Type guard for error objects
    if (error && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;

      if (typeof errorObj['code'] === 'string') {
        dbError.code = errorObj['code'];
      }

      if (typeof errorObj['details'] === 'string') {
        dbError.details = errorObj['details'];
      }

      if (typeof errorObj['message'] === 'string') {
        dbError.message = `${dbError.message} - ${errorObj['message']}`;
      }
    }

    this.logger.error('Database operation failed', {
      operation,
      error:
        error && typeof error === 'object' && 'message' in error
          ? (error as { message: string }).message
          : 'Unknown error',
      code:
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: string }).code
          : undefined,
      details:
        error && typeof error === 'object' && 'details' in error
          ? (error as { details: string }).details
          : undefined,
    });

    throw dbError;
  }

  protected validateRequired(value: unknown, fieldName: string): void {
    if (value === null || value === undefined || value === '') {
      throw new Error(`${fieldName} is required`);
    }
  }

  protected validatePositiveNumber(value: number, fieldName: string): void {
    if (typeof value !== 'number' || value <= 0 || !isFinite(value)) {
      throw new Error(`${fieldName} must be a positive number`);
    }
  }

  protected validateTimestamp(value: Date, fieldName: string): void {
    if (!(value instanceof Date) || isNaN(value.getTime())) {
      throw new Error(`${fieldName} must be a valid Date`);
    }
  }

  protected ensureUtcTimestamp(timestamp: Date): Date {
    // Convert to UTC if not already
    const utcTimestamp = new Date(
      timestamp.getTime() - timestamp.getTimezoneOffset() * 60000
    );
    return utcTimestamp;
  }
}
