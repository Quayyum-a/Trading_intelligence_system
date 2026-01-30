/**
 * Error Handler Service - Comprehensive error handling and recovery for execution engine
 */

import { TradeEventLoggerService } from './trade-event-logger.service';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export enum ExecutionErrorType {
  BROKER_CONNECTION_ERROR = 'BROKER_CONNECTION_ERROR',
  RISK_VALIDATION_ERROR = 'RISK_VALIDATION_ERROR',
  ORDER_PLACEMENT_ERROR = 'ORDER_PLACEMENT_ERROR',
  EXECUTION_REPORT_ERROR = 'EXECUTION_REPORT_ERROR',
  POSITION_MANAGEMENT_ERROR = 'POSITION_MANAGEMENT_ERROR',
  STATE_TRANSITION_ERROR = 'STATE_TRANSITION_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ExecutionError {
  id: string;
  type: ExecutionErrorType;
  severity: ErrorSeverity;
  message: string;
  context: Record<string, any>;
  timestamp: Date;
  tradeId?: string;
  positionId?: string;
  orderId?: string;
  stackTrace?: string;
  recoveryAction?: string;
  isRecoverable: boolean;
}

export interface ErrorRecoveryResult {
  success: boolean;
  action: string;
  message: string;
  retryAfter?: number;
}

export class ErrorHandlerService {
  private eventLogger: TradeEventLoggerService;
  private retryAttempts: Map<string, number> = new Map();
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAYS = [1000, 2000, 5000]; // ms

  constructor(eventLogger: TradeEventLoggerService) {
    this.eventLogger = eventLogger;
  }

  /**
   * Handle execution error with appropriate recovery action
   */
  async handleError(error: Error | ExecutionError, context: Record<string, any> = {}): Promise<ErrorRecoveryResult> {
    try {
      // Convert Error to ExecutionError if needed
      const executionError = this.normalizeError(error, context);

      // Log the error
      await this.logError(executionError);

      // Log error event if trade context is available
      if (executionError.tradeId) {
        await this.eventLogger.logError(executionError.tradeId, {
          errorType: executionError.type,
          errorMessage: executionError.message,
          severity: executionError.severity,
          context: executionError.context,
          timestamp: executionError.timestamp
        });
      }

      // Determine recovery action based on error type and severity
      const recoveryResult = await this.determineRecoveryAction(executionError);

      logger.info('Error handled', {
        errorId: executionError.id,
        errorType: executionError.type,
        severity: executionError.severity,
        recoveryAction: recoveryResult.action,
        success: recoveryResult.success
      });

      return recoveryResult;

    } catch (handlingError) {
      logger.error('Failed to handle error', {
        originalError: error instanceof Error ? error.message : error,
        handlingError: handlingError instanceof Error ? handlingError.message : handlingError
      });

      return {
        success: false,
        action: 'ERROR_HANDLING_FAILED',
        message: 'Failed to handle the original error'
      };
    }
  }

  /**
   * Handle broker connection errors with retry logic
   */
  async handleBrokerConnectionError(
    brokerAdapter: any,
    context: Record<string, any> = {}
  ): Promise<ErrorRecoveryResult> {
    const errorKey = `broker_connection_${Date.now()}`;
    const attempts = this.retryAttempts.get(errorKey) || 0;

    if (attempts >= this.MAX_RETRY_ATTEMPTS) {
      this.retryAttempts.delete(errorKey);
      
      return {
        success: false,
        action: 'MAX_RETRIES_EXCEEDED',
        message: 'Maximum connection retry attempts exceeded. Manual intervention required.'
      };
    }

    try {
      // Wait before retry
      const delay = this.RETRY_DELAYS[attempts] || 5000;
      await this.delay(delay);

      // Attempt to reconnect
      await brokerAdapter.connect();

      // Reset retry counter on success
      this.retryAttempts.delete(errorKey);

      logger.info('Broker connection recovered', {
        attempts: attempts + 1,
        delay
      });

      return {
        success: true,
        action: 'CONNECTION_RECOVERED',
        message: `Broker connection recovered after ${attempts + 1} attempts`
      };

    } catch (retryError) {
      // Increment retry counter
      this.retryAttempts.set(errorKey, attempts + 1);

      logger.warn('Broker connection retry failed', {
        attempt: attempts + 1,
        maxAttempts: this.MAX_RETRY_ATTEMPTS,
        error: retryError instanceof Error ? retryError.message : retryError
      });

      return {
        success: false,
        action: 'RETRY_SCHEDULED',
        message: `Connection retry ${attempts + 1}/${this.MAX_RETRY_ATTEMPTS} failed`,
        retryAfter: this.RETRY_DELAYS[attempts + 1] || 5000
      };
    }
  }

  /**
   * Handle order placement errors
   */
  async handleOrderPlacementError(
    error: Error,
    tradeId: string,
    orderDetails: Record<string, any>
  ): Promise<ErrorRecoveryResult> {
    const executionError: ExecutionError = {
      id: this.generateErrorId(),
      type: ExecutionErrorType.ORDER_PLACEMENT_ERROR,
      severity: ErrorSeverity.HIGH,
      message: error.message,
      context: { tradeId, orderDetails },
      timestamp: new Date(),
      tradeId,
      stackTrace: error.stack,
      isRecoverable: this.isOrderErrorRecoverable(error)
    };

    await this.logError(executionError);

    if (executionError.isRecoverable) {
      // Attempt to retry order placement with adjusted parameters
      return {
        success: false,
        action: 'RETRY_WITH_ADJUSTMENT',
        message: 'Order placement will be retried with adjusted parameters',
        retryAfter: 2000
      };
    } else {
      // Mark trade as failed
      return {
        success: false,
        action: 'TRADE_FAILED',
        message: 'Order placement failed permanently. Trade marked as failed.'
      };
    }
  }

  /**
   * Handle position management errors
   */
  async handlePositionManagementError(
    error: Error,
    positionId: string,
    operation: string
  ): Promise<ErrorRecoveryResult> {
    const executionError: ExecutionError = {
      id: this.generateErrorId(),
      type: ExecutionErrorType.POSITION_MANAGEMENT_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message: error.message,
      context: { positionId, operation },
      timestamp: new Date(),
      positionId,
      stackTrace: error.stack,
      isRecoverable: true
    };

    await this.logError(executionError);

    // Most position management errors are recoverable
    return {
      success: false,
      action: 'RETRY_OPERATION',
      message: `Position ${operation} operation will be retried`,
      retryAfter: 1000
    };
  }

  /**
   * Handle database errors with circuit breaker pattern
   */
  async handleDatabaseError(
    error: Error,
    operation: string,
    context: Record<string, any> = {}
  ): Promise<ErrorRecoveryResult> {
    const executionError: ExecutionError = {
      id: this.generateErrorId(),
      type: ExecutionErrorType.DATABASE_ERROR,
      severity: ErrorSeverity.HIGH,
      message: error.message,
      context: { operation, ...context },
      timestamp: new Date(),
      stackTrace: error.stack,
      isRecoverable: this.isDatabaseErrorRecoverable(error)
    };

    await this.logError(executionError);

    if (executionError.isRecoverable) {
      return {
        success: false,
        action: 'RETRY_DATABASE_OPERATION',
        message: 'Database operation will be retried',
        retryAfter: 2000
      };
    } else {
      return {
        success: false,
        action: 'DATABASE_CIRCUIT_BREAKER',
        message: 'Database circuit breaker activated. Operations suspended.'
      };
    }
  }

  /**
   * Handle network timeout errors
   */
  async handleTimeoutError(
    error: Error,
    operation: string,
    timeout: number
  ): Promise<ErrorRecoveryResult> {
    const executionError: ExecutionError = {
      id: this.generateErrorId(),
      type: ExecutionErrorType.TIMEOUT_ERROR,
      severity: ErrorSeverity.MEDIUM,
      message: `Operation timed out after ${timeout}ms: ${error.message}`,
      context: { operation, timeout },
      timestamp: new Date(),
      stackTrace: error.stack,
      isRecoverable: true
    };

    await this.logError(executionError);

    return {
      success: false,
      action: 'RETRY_WITH_EXTENDED_TIMEOUT',
      message: 'Operation will be retried with extended timeout',
      retryAfter: 1000
    };
  }

  /**
   * Handle state transition errors
   */
  async handleStateTransitionError(
    tradeId: string,
    fromStatus: string,
    toStatus: string,
    error: string
  ): Promise<ErrorRecoveryResult> {
    const executionError: ExecutionError = {
      id: this.generateErrorId(),
      type: ExecutionErrorType.STATE_TRANSITION_ERROR,
      severity: ErrorSeverity.HIGH,
      message: `Invalid state transition: ${fromStatus} -> ${toStatus}: ${error}`,
      context: { tradeId, fromStatus, toStatus },
      timestamp: new Date(),
      tradeId,
      isRecoverable: false
    };

    await this.logError(executionError);

    return {
      success: false,
      action: 'STATE_CORRECTION_REQUIRED',
      message: 'Invalid state transition detected. Manual state correction required.'
    };
  }

  /**
   * Get error statistics
   */
  async getErrorStatistics(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalErrors: number;
    errorsByType: Record<ExecutionErrorType, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    recoveryRate: number;
    mostCommonError: ExecutionErrorType;
  }> {
    // In a real implementation, this would query error logs from database
    // For now, return mock statistics
    return {
      totalErrors: 0,
      errorsByType: {} as Record<ExecutionErrorType, number>,
      errorsBySeverity: {} as Record<ErrorSeverity, number>,
      recoveryRate: 0,
      mostCommonError: ExecutionErrorType.UNKNOWN_ERROR
    };
  }

  /**
   * Private helper methods
   */

  private normalizeError(error: Error | ExecutionError, context: Record<string, any>): ExecutionError {
    if (this.isExecutionError(error)) {
      return error;
    }

    // Convert Error to ExecutionError
    return {
      id: this.generateErrorId(),
      type: this.classifyError(error),
      severity: this.determineSeverity(error),
      message: error.message,
      context,
      timestamp: new Date(),
      stackTrace: error.stack,
      isRecoverable: this.isErrorRecoverable(error)
    };
  }

  private isExecutionError(error: any): error is ExecutionError {
    return error && typeof error === 'object' && 'type' in error && 'severity' in error;
  }

  private classifyError(error: Error): ExecutionErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes('connection') || message.includes('network')) {
      return ExecutionErrorType.NETWORK_ERROR;
    }
    if (message.includes('timeout')) {
      return ExecutionErrorType.TIMEOUT_ERROR;
    }
    if (message.includes('database') || message.includes('sql')) {
      return ExecutionErrorType.DATABASE_ERROR;
    }
    if (message.includes('validation')) {
      return ExecutionErrorType.VALIDATION_ERROR;
    }
    if (message.includes('broker')) {
      return ExecutionErrorType.BROKER_CONNECTION_ERROR;
    }
    
    return ExecutionErrorType.UNKNOWN_ERROR;
  }

  private determineSeverity(error: Error): ErrorSeverity {
    const message = error.message.toLowerCase();
    
    if (message.includes('critical') || message.includes('fatal')) {
      return ErrorSeverity.CRITICAL;
    }
    if (message.includes('connection') || message.includes('database')) {
      return ErrorSeverity.HIGH;
    }
    if (message.includes('timeout') || message.includes('retry')) {
      return ErrorSeverity.MEDIUM;
    }
    
    return ErrorSeverity.LOW;
  }

  private isErrorRecoverable(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Non-recoverable errors
    if (message.includes('invalid') || message.includes('unauthorized') || message.includes('forbidden')) {
      return false;
    }
    
    // Recoverable errors
    if (message.includes('timeout') || message.includes('connection') || message.includes('network')) {
      return true;
    }
    
    return true; // Default to recoverable
  }

  private isOrderErrorRecoverable(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Non-recoverable order errors
    if (message.includes('insufficient funds') || message.includes('invalid symbol') || message.includes('market closed')) {
      return false;
    }
    
    return true;
  }

  private isDatabaseErrorRecoverable(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Non-recoverable database errors
    if (message.includes('constraint violation') || message.includes('duplicate key')) {
      return false;
    }
    
    return true;
  }

  private async determineRecoveryAction(error: ExecutionError): Promise<ErrorRecoveryResult> {
    switch (error.type) {
      case ExecutionErrorType.BROKER_CONNECTION_ERROR:
        return {
          success: false,
          action: 'RECONNECT_BROKER',
          message: 'Attempting to reconnect to broker',
          retryAfter: 2000
        };
      
      case ExecutionErrorType.NETWORK_ERROR:
      case ExecutionErrorType.TIMEOUT_ERROR:
        return {
          success: false,
          action: 'RETRY_OPERATION',
          message: 'Retrying operation after network/timeout error',
          retryAfter: 1000
        };
      
      case ExecutionErrorType.DATABASE_ERROR:
        return error.isRecoverable ? {
          success: false,
          action: 'RETRY_DATABASE_OPERATION',
          message: 'Retrying database operation',
          retryAfter: 2000
        } : {
          success: false,
          action: 'MANUAL_INTERVENTION_REQUIRED',
          message: 'Database error requires manual intervention'
        };
      
      case ExecutionErrorType.STATE_TRANSITION_ERROR:
        return {
          success: false,
          action: 'STATE_CORRECTION_REQUIRED',
          message: 'Invalid state transition requires correction'
        };
      
      default:
        return {
          success: false,
          action: 'LOG_AND_CONTINUE',
          message: 'Error logged, continuing operation'
        };
    }
  }

  private async logError(error: ExecutionError): Promise<void> {
    logger.error('Execution error occurred', {
      errorId: error.id,
      type: error.type,
      severity: error.severity,
      message: error.message,
      context: error.context,
      tradeId: error.tradeId,
      positionId: error.positionId,
      orderId: error.orderId,
      isRecoverable: error.isRecoverable,
      timestamp: error.timestamp
    });

    // In a real implementation, this would also store the error in a database
    // for later analysis and reporting
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear retry attempts for a specific key
   */
  clearRetryAttempts(key: string): void {
    this.retryAttempts.delete(key);
  }

  /**
   * Get current retry attempts for monitoring
   */
  getRetryAttempts(): Map<string, number> {
    return new Map(this.retryAttempts);
  }
}