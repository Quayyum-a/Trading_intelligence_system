import type { StrategyDecision } from './strategy.types.js';
import { StrategyValidationError, StrategyCalculationError, StrategyConfigurationError } from './strategy-validation.js';

export interface ErrorContext {
  stage: string;
  candleId?: string;
  timestamp?: Date;
  additionalData?: any;
}

export interface ErrorRecoveryResult {
  canContinue: boolean;
  fallbackDecision?: StrategyDecision;
  retryable: boolean;
  errorCode: string;
}

/**
 * Centralized error handling for strategy engine
 */
export class StrategyErrorHandler {
  private errorCounts: Map<string, number> = new Map();
  private readonly maxRetries = 3;
  private readonly errorThreshold = 10;

  /**
   * Handle errors during strategy processing
   */
  handleError(error: Error, context: ErrorContext): ErrorRecoveryResult {
    const errorCode = this.classifyError(error);
    this.incrementErrorCount(errorCode);

    // Log error with context
    console.error(`Strategy Error [${errorCode}] in ${context.stage}:`, {
      message: error.message,
      stack: error.stack,
      context
    });

    // Determine recovery strategy
    return this.determineRecovery(error, errorCode, context);
  }

  /**
   * Classify error type for appropriate handling
   */
  private classifyError(error: Error): string {
    if (error instanceof StrategyValidationError) {
      return `VALIDATION_${error.code}`;
    }

    if (error instanceof StrategyCalculationError) {
      return `CALCULATION_${error.stage}`;
    }

    if (error instanceof StrategyConfigurationError) {
      return `CONFIG_${error.parameter}`;
    }

    // Database errors
    if (error.message.includes('database') || error.message.includes('connection')) {
      return 'DATABASE_ERROR';
    }

    // Network errors
    if (error.message.includes('network') || error.message.includes('timeout')) {
      return 'NETWORK_ERROR';
    }

    // Memory errors
    if (error.message.includes('memory') || error.message.includes('heap')) {
      return 'MEMORY_ERROR';
    }

    // Division by zero
    if (error.message.includes('division by zero') || error.message.includes('divide by zero')) {
      return 'DIVISION_BY_ZERO';
    }

    // Invalid data
    if (error.message.includes('NaN') || error.message.includes('infinite')) {
      return 'INVALID_CALCULATION';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Determine recovery strategy based on error type
   */
  private determineRecovery(error: Error, errorCode: string, context: ErrorContext): ErrorRecoveryResult {
    const errorCount = this.errorCounts.get(errorCode) || 0;

    // Check if error threshold exceeded
    if (errorCount > this.errorThreshold) {
      return {
        canContinue: false,
        retryable: false,
        errorCode,
        fallbackDecision: this.createErrorFallbackDecision(context)
      };
    }

    switch (errorCode) {
      case 'VALIDATION_INVALID_CANDLE':
      case 'VALIDATION_INVALID_INDICATORS':
        return {
          canContinue: false,
          retryable: false,
          errorCode,
          fallbackDecision: this.createNoTradeDecision(context, 'Invalid input data')
        };

      case 'CALCULATION_REGIME':
      case 'CALCULATION_SETUP':
      case 'CALCULATION_QUALIFICATION':
        return {
          canContinue: false,
          retryable: errorCount < this.maxRetries,
          errorCode,
          fallbackDecision: this.createNoTradeDecision(context, 'Calculation error')
        };

      case 'DIVISION_BY_ZERO':
      case 'INVALID_CALCULATION':
        return {
          canContinue: false,
          retryable: false,
          errorCode,
          fallbackDecision: this.createNoTradeDecision(context, 'Mathematical error')
        };

      case 'DATABASE_ERROR':
        return {
          canContinue: errorCount < this.maxRetries,
          retryable: true,
          errorCode
        };

      case 'NETWORK_ERROR':
        return {
          canContinue: errorCount < this.maxRetries,
          retryable: true,
          errorCode
        };

      case 'MEMORY_ERROR':
        return {
          canContinue: false,
          retryable: false,
          errorCode
        };

      case 'CONFIG_RISK':
      case 'CONFIG_CONFIDENCE':
        return {
          canContinue: false,
          retryable: false,
          errorCode,
          fallbackDecision: this.createNoTradeDecision(context, 'Configuration error')
        };

      default:
        return {
          canContinue: errorCount < this.maxRetries,
          retryable: true,
          errorCode,
          fallbackDecision: this.createNoTradeDecision(context, 'Unknown error')
        };
    }
  }

  /**
   * Create NO_TRADE decision for error cases
   */
  private createNoTradeDecision(context: ErrorContext, reason: string): StrategyDecision {
    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      candleId: context.candleId || '',
      pair: 'XAU/USD', // Default pair
      timeframe: '15M', // Default timeframe
      decision: 'NO_TRADE',
      regime: 'NO_TRADE',
      confidenceScore: 0,
      reason: {
        regime: 'ERROR',
        setup: 'ERROR',
        structure: 'ERROR',
        atr: 'ERROR',
        riskCheck: 'ERROR',
        leverageCheck: 'ERROR',
        confidenceCheck: 'ERROR',
        timeCheck: 'ERROR'
      },
      tradingWindowStart: '14:00',
      tradingWindowEnd: '18:00',
      candleTimestamp: context.timestamp || new Date()
    };
  }

  /**
   * Create fallback decision for critical errors
   */
  private createErrorFallbackDecision(context: ErrorContext): StrategyDecision {
    return this.createNoTradeDecision(context, 'Critical error - engine stopped');
  }

  /**
   * Increment error count for tracking
   */
  private incrementErrorCount(errorCode: string): void {
    const current = this.errorCounts.get(errorCode) || 0;
    this.errorCounts.set(errorCode, current + 1);
  }

  /**
   * Reset error counts (for recovery)
   */
  resetErrorCounts(): void {
    this.errorCounts.clear();
  }

  /**
   * Get error statistics
   */
  getErrorStats(): { [errorCode: string]: number } {
    return Object.fromEntries(this.errorCounts);
  }

  /**
   * Check if error threshold exceeded for any error type
   */
  isErrorThresholdExceeded(): boolean {
    for (const count of this.errorCounts.values()) {
      if (count > this.errorThreshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Handle database connection errors with retry logic
   */
  async handleDatabaseError<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break;
        }

        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await this.sleep(delay);
        
        console.warn(`Database operation failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, error);
      }
    }

    throw new Error(`Database operation failed after ${maxRetries} attempts: ${lastError!.message}`);
  }

  /**
   * Handle calculation errors with safe fallbacks
   */
  safeCalculation<T>(
    calculation: () => T,
    fallback: T,
    context: ErrorContext
  ): T {
    try {
      const result = calculation();
      
      // Validate result
      if (typeof result === 'number') {
        if (isNaN(result) || !isFinite(result)) {
          console.warn(`Invalid calculation result in ${context.stage}, using fallback:`, { result, fallback });
          return fallback;
        }
      }
      
      return result;
    } catch (error) {
      console.warn(`Calculation error in ${context.stage}, using fallback:`, error);
      return fallback;
    }
  }

  /**
   * Validate and sanitize input data
   */
  sanitizeInput<T>(
    input: T,
    validator: (input: T) => boolean,
    sanitizer: (input: T) => T,
    context: ErrorContext
  ): T {
    try {
      if (validator(input)) {
        return input;
      }
      
      const sanitized = sanitizer(input);
      console.warn(`Input sanitized in ${context.stage}:`, { original: input, sanitized });
      return sanitized;
    } catch (error) {
      throw new StrategyValidationError(
        `Input validation failed in ${context.stage}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'INPUT_SANITIZATION',
        { input, context }
      );
    }
  }

  /**
   * Circuit breaker pattern for critical operations
   */
  private circuitBreakerStates: Map<string, {
    failures: number;
    lastFailure: Date;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  }> = new Map();

  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: ErrorContext
  ): Promise<T> {
    const breaker = this.circuitBreakerStates.get(operationName) || {
      failures: 0,
      lastFailure: new Date(0),
      state: 'CLOSED' as const
    };

    // Check circuit breaker state
    if (breaker.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - breaker.lastFailure.getTime();
      if (timeSinceLastFailure < 60000) { // 1 minute timeout
        throw new Error(`Circuit breaker OPEN for ${operationName}`);
      } else {
        breaker.state = 'HALF_OPEN';
      }
    }

    try {
      const result = await operation();
      
      // Reset on success
      if (breaker.state === 'HALF_OPEN') {
        breaker.state = 'CLOSED';
        breaker.failures = 0;
      }
      
      this.circuitBreakerStates.set(operationName, breaker);
      return result;
    } catch (error) {
      breaker.failures++;
      breaker.lastFailure = new Date();
      
      if (breaker.failures >= 5) {
        breaker.state = 'OPEN';
      }
      
      this.circuitBreakerStates.set(operationName, breaker);
      throw error;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create error context for operations
   */
  createContext(stage: string, candleId?: string, timestamp?: Date, additionalData?: any): ErrorContext {
    return {
      stage,
      candleId,
      timestamp,
      additionalData
    };
  }

  /**
   * Log error for monitoring and debugging
   */
  logError(error: Error, context: ErrorContext, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      severity,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      errorCode: this.classifyError(error)
    };

    // In production, this would go to a proper logging service
    console.error(`[${severity}] Strategy Engine Error:`, logEntry);
  }
}