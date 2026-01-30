/**
 * Risk Validator Interface - Enforces risk limits and validates trade parameters
 */

import { ExecutionTrade, RiskValidationResult, TradeSignal } from '../types/execution.types';

export interface RiskValidator {
  /**
   * Validate a trade signal against risk limits
   * @param signal - Trade signal to validate
   * @param accountBalance - Current account balance
   * @returns Promise<RiskValidationResult> - Validation result with any violations
   */
  validateTrade(signal: TradeSignal, accountBalance: number): Promise<RiskValidationResult>;

  /**
   * Check if margin requirement can be met for a trade
   * @param trade - Execution trade to check
   * @returns Promise<boolean> - True if margin requirement can be met
   */
  checkMarginRequirement(trade: ExecutionTrade): Promise<boolean>;

  /**
   * Enforce position limits for a new trade
   * @param newTrade - New execution trade to validate
   * @returns Promise<boolean> - True if position limits are not exceeded
   */
  enforcePositionLimits(newTrade: ExecutionTrade): Promise<boolean>;
}