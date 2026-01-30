/**
 * Trade Execution Engine - Main Export
 * 
 * A deterministic, broker-agnostic execution engine that consumes Strategy Engine outputs,
 * executes trades through configurable broker adapters, and manages the complete trade lifecycle.
 */

// Core Services
export { ExecutionEngineService } from './services/execution-engine.service';
export { RiskValidatorService } from './services/risk-validator.service';
export { OrderManagerService } from './services/order-manager.service';
export { PositionManagerService } from './services/position-manager.service';
export { TradeLifecycleService } from './services/trade-lifecycle.service';
export { TradeEventLoggerService } from './services/trade-event-logger.service';
export { PositionSizingService } from './services/position-sizing.service';
export { PnLCalculatorService } from './services/pnl-calculator.service';
export { PositionClosureService } from './services/position-closure.service';
export { SLTPManagerService } from './services/sl-tp-manager.service';
export { ExecutionReporterService } from './services/execution-reporter.service';
export { ExecutionReportingService } from './services/execution-reporting.service';
export { ErrorHandlerService } from './services/error-handler.service';
export { AuditLoggerService } from './services/audit-logger.service';

// Broker Adapters
export { BaseBrokerAdapter } from './adapters/base-broker.adapter';
export { PaperBrokerAdapter } from './adapters/paper-broker.adapter';
export { BrokerFactory } from './adapters/broker-factory';

// Interfaces
export * from './interfaces';

// Types
export * from './types/execution.types';

// Test Utilities
export * from './tests/setup';