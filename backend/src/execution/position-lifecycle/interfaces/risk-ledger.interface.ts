/**
 * Risk Ledger Service Interface - Manages margin, balance, and risk
 */

import { BalanceChange, MarginStatus, LiquidationResult } from '../types/position-lifecycle.types';

export interface IRiskLedgerService {
  /**
   * Reserve margin for a position
   * @param positionId - ID of the position
   * @param marginAmount - Amount of margin to reserve
   * @returns Promise<void>
   */
  reserveMargin(positionId: string, marginAmount: number): Promise<void>;

  /**
   * Release margin from a closed position
   * @param positionId - ID of the position
   * @param marginAmount - Amount of margin to release
   * @returns Promise<void>
   */
  releaseMargin(positionId: string, marginAmount: number): Promise<void>;

  /**
   * Update account balance with realized PnL
   * @param balanceChange - Balance change details
   * @returns Promise<void>
   */
  updateAccountBalance(balanceChange: BalanceChange): Promise<void>;

  /**
   * Check margin requirements for an account
   * @param accountId - ID of the account to check
   * @returns Promise<MarginStatus> - Current margin status
   */
  checkMarginRequirements(accountId: string): Promise<MarginStatus>;

  /**
   * Trigger forced liquidation for an account
   * @param accountId - ID of the account to liquidate
   * @returns Promise<LiquidationResult> - Result of liquidation process
   */
  triggerLiquidation(accountId: string): Promise<LiquidationResult>;
}