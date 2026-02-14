import { getLogger } from '../config/logger.js';
import { BrokerError, BrokerConnectionError, BrokerAuthenticationError, BrokerRateLimitError } from '../brokers/broker.interface.js';

/**
 * Enhanced Error Recovery Service for Market Data Ingestion
 * 
 * Implements comprehensive error classification, recovery workflows,
 * and circuit breaker patterns for external API calls.
 * 
 * Features:
 * - Error classification and categorization
 * - Circuit breaker pattern for API resilience
 * - Data consistency validation during recovery
 * - Recovery workflow orchestration
 * - Fallback strategies and graceful degradation
 * 
 * Requirements: 1.3, 1.5
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  NETWORK = 'network',
  DATA_VALIDATION = 'data_validation',
  TIMEOUT = 'timeout',
  SYSTEM = 'system'
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  BACKOFF = 'backoff',
  CIRCUIT_BREAKER = 'circuit_breaker',
  FALLBACK = 'fallback',
  SKIP = 'skip',
  ABORT = 'abort'
}

export interface ErrorClassification {
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoveryStrategy: RecoveryStrategy;
  isRecoverable: boolean;
  maxRetries: number;
  baseDelayMs: number;
  requiresManualIntervention: boolean;
  description: string;
}

export interface RecoveryContext {
  operationId: string;
  operationType: string;
  attemptCount: number;
  startTime: Date;
  lastError?: Error;
  metadata: Record<string, any>;
}

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  attemptCount: number;
  totalTimeMs: number;
  finalError?: Error;
  recoveryActions: string[];
  dataConsistencyValidated: boolean;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: Date | null;
  nextAttemptTime: Date | null;
  successCount: number;
  totalRequests: number;
}

export class ErrorRecoveryService {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private recoveryHistory: Map<string, RecoveryResult[]> = new Map();
  
  // Circuit breaker configuration
  private readonly failureThreshold = 5;
  private readonly recoveryTimeoutMs = 30000; // 30 seconds
  private readonly halfOpenMaxRequests = 3;
  
  constructor() {
    const logger = getLogger();
    logger.info('ErrorRecoveryService initialized', {
      failureThreshold: this.failureThreshold,
      recoveryTimeoutMs: this.recoveryTimeoutMs,
      halfOpenMaxRequests: this.halfOpenMaxRequests,
    });
  }

  /**
   * Classifies an error and determines the appropriate recovery strategy
   */
  classifyError(error: Error): ErrorClassification {
    const logger = getLogger();
    
    // Classify based on error type and message
    let classification: ErrorClassification;
    
    if (error instanceof BrokerAuthenticationError) {
      classification = {
        category: ErrorCategory.AUTHENTICATION,
        severity: ErrorSeverity.CRITICAL,
        recoveryStrategy: RecoveryStrategy.ABORT,
        isRecoverable: false,
        maxRetries: 0,
        baseDelayMs: 0,
        requiresManualIntervention: true,
        description: 'Authentication failure requires credential refresh'
      };
    } else if (error instanceof BrokerRateLimitError) {
      classification = {
        category: ErrorCategory.RATE_LIMIT,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.BACKOFF,
        isRecoverable: true,
        maxRetries: 10,
        baseDelayMs: 5000,
        requiresManualIntervention: false,
        description: 'Rate limit exceeded, exponential backoff required'
      };
    } else if (error instanceof BrokerConnectionError) {
      classification = {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.CIRCUIT_BREAKER,
        isRecoverable: true,
        maxRetries: 3,
        baseDelayMs: 2000,
        requiresManualIntervention: false,
        description: 'Network connectivity issue, circuit breaker pattern recommended'
      };
    } else if (error.message.includes('timeout') || error.name === 'TimeoutError' || error.name === 'AbortError') {
      classification = {
        category: ErrorCategory.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.RETRY,
        isRecoverable: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        requiresManualIntervention: false,
        description: 'Request timeout, retry with progressive delays'
      };
    } else if (error.message.includes('validation') || error.message.includes('invalid data')) {
      classification = {
        category: ErrorCategory.DATA_VALIDATION,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.SKIP,
        isRecoverable: false,
        maxRetries: 0,
        baseDelayMs: 0,
        requiresManualIntervention: true,
        description: 'Data validation failure, manual review required'
      };
    } else if (error.message.includes('count') && error.message.includes('exceeded')) {
      classification = {
        category: ErrorCategory.TRANSIENT,
        severity: ErrorSeverity.LOW,
        recoveryStrategy: RecoveryStrategy.RETRY,
        isRecoverable: true,
        maxRetries: 1,
        baseDelayMs: 500,
        requiresManualIntervention: false,
        description: 'Request parameter issue, retry with adjusted parameters'
      };
    } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      classification = {
        category: ErrorCategory.TRANSIENT,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.BACKOFF,
        isRecoverable: true,
        maxRetries: 5,
        baseDelayMs: 3000,
        requiresManualIntervention: false,
        description: 'Server error, exponential backoff recommended'
      };
    } else {
      // Default classification for unknown errors
      classification = {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.RETRY,
        isRecoverable: true,
        maxRetries: 2,
        baseDelayMs: 1000,
        requiresManualIntervention: false,
        description: 'Unknown error, limited retry attempts'
      };
    }
    
    logger.debug('Error classified', {
      errorType: error.constructor.name,
      errorMessage: error.message,
      classification,
    });
    
    return classification;
  }

  /**
   * Executes recovery workflow for a classified error
   */
  async executeRecovery<T>(
    context: RecoveryContext,
    operation: () => Promise<T>,
    classification: ErrorClassification
  ): Promise<{ result: T; recoveryResult: RecoveryResult }> {
    const logger = getLogger();
    const startTime = Date.now();
    const recoveryActions: string[] = [];
    
    logger.info('Starting error recovery workflow', {
      operationId: context.operationId,
      operationType: context.operationType,
      classification,
      attemptCount: context.attemptCount,
    });

    const recoveryResult: RecoveryResult = {
      success: false,
      strategy: classification.recoveryStrategy,
      attemptCount: 0,
      totalTimeMs: 0,
      recoveryActions,
      dataConsistencyValidated: false,
    };

    try {
      let result: T;
      
      switch (classification.recoveryStrategy) {
        case RecoveryStrategy.RETRY:
          result = await this.executeRetryStrategy(context, operation, classification, recoveryActions);
          break;
          
        case RecoveryStrategy.BACKOFF:
          result = await this.executeBackoffStrategy(context, operation, classification, recoveryActions);
          break;
          
        case RecoveryStrategy.CIRCUIT_BREAKER:
          result = await this.executeCircuitBreakerStrategy(context, operation, classification, recoveryActions);
          break;
          
        case RecoveryStrategy.FALLBACK:
          result = await this.executeFallbackStrategy(context, operation, classification, recoveryActions);
          break;
          
        case RecoveryStrategy.SKIP:
          recoveryActions.push('Operation skipped due to unrecoverable error');
          throw context.lastError || new Error('Operation skipped');
          
        case RecoveryStrategy.ABORT:
          recoveryActions.push('Operation aborted due to critical error');
          throw context.lastError || new Error('Operation aborted');
          
        default:
          throw new Error(`Unknown recovery strategy: ${classification.recoveryStrategy}`);
      }
      
      // Validate data consistency after successful recovery
      const consistencyValid = await this.validateDataConsistency(context, result);
      recoveryResult.dataConsistencyValidated = consistencyValid;
      
      if (!consistencyValid) {
        recoveryActions.push('Data consistency validation failed');
        throw new Error('Data consistency validation failed after recovery');
      }
      
      recoveryResult.success = true;
      recoveryResult.totalTimeMs = Date.now() - startTime;
      
      // Record successful recovery
      this.recordRecoveryResult(context.operationId, recoveryResult);
      
      logger.info('Error recovery completed successfully', {
        operationId: context.operationId,
        strategy: classification.recoveryStrategy,
        totalTimeMs: recoveryResult.totalTimeMs,
        recoveryActions,
      });
      
      return { result, recoveryResult };
      
    } catch (error) {
      recoveryResult.success = false;
      recoveryResult.finalError = error instanceof Error ? error : new Error('Unknown recovery error');
      recoveryResult.totalTimeMs = Date.now() - startTime;
      
      // Record failed recovery
      this.recordRecoveryResult(context.operationId, recoveryResult);
      
      logger.error('Error recovery failed', {
        operationId: context.operationId,
        strategy: classification.recoveryStrategy,
        finalError: recoveryResult.finalError.message,
        totalTimeMs: recoveryResult.totalTimeMs,
        recoveryActions,
      });
      
      throw recoveryResult.finalError;
    }
  }

  /**
   * Executes retry strategy with simple retry logic
   */
  private async executeRetryStrategy<T>(
    context: RecoveryContext,
    operation: () => Promise<T>,
    classification: ErrorClassification,
    recoveryActions: string[]
  ): Promise<T> {
    const logger = getLogger();
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= classification.maxRetries + 1; attempt++) {
      try {
        if (attempt > 1) {
          const delay = classification.baseDelayMs * attempt;
          recoveryActions.push(`Retry attempt ${attempt} after ${delay}ms delay`);
          logger.debug('Retry attempt with delay', {
            operationId: context.operationId,
            attempt,
            delay,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const result = await operation();
        
        if (attempt > 1) {
          recoveryActions.push(`Operation succeeded on retry attempt ${attempt}`);
          logger.info('Operation succeeded after retry', {
            operationId: context.operationId,
            attempt,
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt <= classification.maxRetries) {
          logger.warn('Retry attempt failed', {
            operationId: context.operationId,
            attempt,
            maxRetries: classification.maxRetries,
            error: lastError.message,
          });
        }
      }
    }
    
    recoveryActions.push(`All retry attempts exhausted (${classification.maxRetries + 1} attempts)`);
    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Executes exponential backoff strategy
   */
  private async executeBackoffStrategy<T>(
    context: RecoveryContext,
    operation: () => Promise<T>,
    classification: ErrorClassification,
    recoveryActions: string[]
  ): Promise<T> {
    const logger = getLogger();
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= classification.maxRetries + 1; attempt++) {
      try {
        if (attempt > 1) {
          // Exponential backoff with jitter
          const baseDelay = classification.baseDelayMs * Math.pow(2, attempt - 2);
          const jitter = baseDelay * 0.1 * Math.random();
          const delay = Math.floor(baseDelay + jitter);
          
          recoveryActions.push(`Exponential backoff attempt ${attempt} after ${delay}ms delay`);
          logger.debug('Exponential backoff attempt', {
            operationId: context.operationId,
            attempt,
            baseDelay,
            jitter,
            totalDelay: delay,
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const result = await operation();
        
        if (attempt > 1) {
          recoveryActions.push(`Operation succeeded on backoff attempt ${attempt}`);
          logger.info('Operation succeeded after exponential backoff', {
            operationId: context.operationId,
            attempt,
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt <= classification.maxRetries) {
          logger.warn('Backoff attempt failed', {
            operationId: context.operationId,
            attempt,
            maxRetries: classification.maxRetries,
            error: lastError.message,
          });
        }
      }
    }
    
    recoveryActions.push(`All backoff attempts exhausted (${classification.maxRetries + 1} attempts)`);
    throw lastError || new Error('All backoff attempts failed');
  }

  /**
   * Executes circuit breaker strategy
   */
  private async executeCircuitBreakerStrategy<T>(
    context: RecoveryContext,
    operation: () => Promise<T>,
    classification: ErrorClassification,
    recoveryActions: string[]
  ): Promise<T> {
    const logger = getLogger();
    const circuitKey = `${context.operationType}_${context.metadata.endpoint || 'default'}`;
    
    // Check circuit breaker state
    const circuitState = this.getCircuitBreakerState(circuitKey);
    
    if (circuitState.state === 'OPEN') {
      const now = new Date();
      if (circuitState.nextAttemptTime && now < circuitState.nextAttemptTime) {
        recoveryActions.push('Circuit breaker is OPEN, operation blocked');
        throw new Error('Circuit breaker is OPEN, operation temporarily blocked');
      } else {
        // Transition to HALF_OPEN
        circuitState.state = 'HALF_OPEN';
        circuitState.successCount = 0;
        recoveryActions.push('Circuit breaker transitioned to HALF_OPEN');
        logger.info('Circuit breaker transitioned to HALF_OPEN', { circuitKey });
      }
    }
    
    if (circuitState.state === 'HALF_OPEN' && circuitState.successCount >= this.halfOpenMaxRequests) {
      recoveryActions.push('Circuit breaker HALF_OPEN limit reached, operation blocked');
      throw new Error('Circuit breaker HALF_OPEN request limit reached');
    }
    
    try {
      const result = await operation();
      
      // Success - update circuit breaker
      circuitState.successCount++;
      circuitState.totalRequests++;
      
      if (circuitState.state === 'HALF_OPEN' && circuitState.successCount >= this.halfOpenMaxRequests) {
        // Transition back to CLOSED
        circuitState.state = 'CLOSED';
        circuitState.failureCount = 0;
        circuitState.lastFailureTime = null;
        circuitState.nextAttemptTime = null;
        recoveryActions.push('Circuit breaker transitioned to CLOSED after successful recovery');
        logger.info('Circuit breaker transitioned to CLOSED', { circuitKey });
      }
      
      this.updateCircuitBreakerState(circuitKey, circuitState);
      
      if (circuitState.state !== 'CLOSED') {
        recoveryActions.push(`Operation succeeded with circuit breaker in ${circuitState.state} state`);
      }
      
      return result;
      
    } catch (error) {
      // Failure - update circuit breaker
      circuitState.failureCount++;
      circuitState.totalRequests++;
      circuitState.lastFailureTime = new Date();
      
      if (circuitState.failureCount >= this.failureThreshold) {
        // Transition to OPEN
        circuitState.state = 'OPEN';
        circuitState.nextAttemptTime = new Date(Date.now() + this.recoveryTimeoutMs);
        recoveryActions.push(`Circuit breaker transitioned to OPEN after ${circuitState.failureCount} failures`);
        logger.warn('Circuit breaker transitioned to OPEN', {
          circuitKey,
          failureCount: circuitState.failureCount,
          nextAttemptTime: circuitState.nextAttemptTime,
        });
      }
      
      this.updateCircuitBreakerState(circuitKey, circuitState);
      
      recoveryActions.push(`Operation failed, circuit breaker failure count: ${circuitState.failureCount}`);
      throw error;
    }
  }

  /**
   * Executes fallback strategy (placeholder for future implementation)
   */
  private async executeFallbackStrategy<T>(
    context: RecoveryContext,
    operation: () => Promise<T>,
    classification: ErrorClassification,
    recoveryActions: string[]
  ): Promise<T> {
    const logger = getLogger();
    
    try {
      // First try the original operation
      const result = await operation();
      recoveryActions.push('Original operation succeeded, no fallback needed');
      return result;
      
    } catch (error) {
      recoveryActions.push('Original operation failed, fallback strategy not yet implemented');
      logger.warn('Fallback strategy requested but not implemented', {
        operationId: context.operationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // For now, just rethrow the error
      // In the future, this could implement cached data fallback, alternative data sources, etc.
      throw error;
    }
  }

  /**
   * Validates data consistency after recovery operations
   */
  private async validateDataConsistency<T>(context: RecoveryContext, result: T): Promise<boolean> {
    const logger = getLogger();
    
    try {
      // Basic validation checks
      if (result === null || result === undefined) {
        logger.warn('Data consistency validation failed: null or undefined result', {
          operationId: context.operationId,
        });
        return false;
      }
      
      // For array results (like candle data), check for basic consistency
      if (Array.isArray(result)) {
        const arrayResult = result as unknown[];
        
        // Check for empty arrays
        if (arrayResult.length === 0) {
          logger.debug('Data consistency validation: empty array result', {
            operationId: context.operationId,
          });
          return true; // Empty arrays can be valid
        }
        
        // Check for duplicate timestamps in candle data
        if (arrayResult.length > 0 && typeof arrayResult[0] === 'object' && arrayResult[0] !== null) {
          const firstItem = arrayResult[0] as any;
          if (firstItem.timestamp) {
            const timestamps = arrayResult
              .map((item: any) => item.timestamp)
              .filter(ts => ts !== undefined);
            
            const uniqueTimestamps = new Set(timestamps);
            if (timestamps.length !== uniqueTimestamps.size) {
              logger.warn('Data consistency validation failed: duplicate timestamps detected', {
                operationId: context.operationId,
                totalItems: arrayResult.length,
                uniqueTimestamps: uniqueTimestamps.size,
                duplicates: timestamps.length - uniqueTimestamps.size,
              });
              return false;
            }
          }
        }
      }
      
      logger.debug('Data consistency validation passed', {
        operationId: context.operationId,
        resultType: typeof result,
        isArray: Array.isArray(result),
        arrayLength: Array.isArray(result) ? (result as unknown[]).length : undefined,
      });
      
      return true;
      
    } catch (error) {
      logger.error('Data consistency validation error', {
        operationId: context.operationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Gets the current state of a circuit breaker
   */
  private getCircuitBreakerState(key: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, {
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        successCount: 0,
        totalRequests: 0,
      });
    }
    
    return this.circuitBreakers.get(key)!;
  }

  /**
   * Updates the state of a circuit breaker
   */
  private updateCircuitBreakerState(key: string, state: CircuitBreakerState): void {
    this.circuitBreakers.set(key, { ...state });
  }

  /**
   * Records a recovery result for analysis and monitoring
   */
  private recordRecoveryResult(operationId: string, result: RecoveryResult): void {
    if (!this.recoveryHistory.has(operationId)) {
      this.recoveryHistory.set(operationId, []);
    }
    
    const history = this.recoveryHistory.get(operationId)!;
    history.push({ ...result });
    
    // Keep only the last 10 recovery attempts per operation
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
  }

  /**
   * Gets recovery statistics for monitoring and analysis
   */
  getRecoveryStatistics(): {
    totalOperations: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    averageRecoveryTimeMs: number;
    circuitBreakerStates: Record<string, CircuitBreakerState>;
    recoveryStrategiesUsed: Record<RecoveryStrategy, number>;
  } {
    let totalOperations = 0;
    let successfulRecoveries = 0;
    let failedRecoveries = 0;
    let totalRecoveryTime = 0;
    const strategyUsage: Record<RecoveryStrategy, number> = {} as Record<RecoveryStrategy, number>;
    
    for (const history of this.recoveryHistory.values()) {
      for (const result of history) {
        totalOperations++;
        totalRecoveryTime += result.totalTimeMs;
        
        if (result.success) {
          successfulRecoveries++;
        } else {
          failedRecoveries++;
        }
        
        strategyUsage[result.strategy] = (strategyUsage[result.strategy] || 0) + 1;
      }
    }
    
    const circuitBreakerStates: Record<string, CircuitBreakerState> = {};
    for (const [key, state] of this.circuitBreakers.entries()) {
      circuitBreakerStates[key] = { ...state };
    }
    
    return {
      totalOperations,
      successfulRecoveries,
      failedRecoveries,
      averageRecoveryTimeMs: totalOperations > 0 ? totalRecoveryTime / totalOperations : 0,
      circuitBreakerStates,
      recoveryStrategiesUsed: strategyUsage,
    };
  }

  /**
   * Resets all circuit breakers (for testing or maintenance)
   */
  resetCircuitBreakers(): void {
    this.circuitBreakers.clear();
    
    const logger = getLogger();
    logger.info('All circuit breakers reset');
  }

  /**
   * Resets recovery history (for testing or maintenance)
   */
  resetRecoveryHistory(): void {
    this.recoveryHistory.clear();
    
    const logger = getLogger();
    logger.info('Recovery history reset');
  }
}

/**
 * Default error recovery service instance
 */
export const errorRecoveryService = new ErrorRecoveryService();