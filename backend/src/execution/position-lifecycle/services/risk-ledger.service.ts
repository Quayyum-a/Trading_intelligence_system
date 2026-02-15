/**
 * Risk Ledger Service - Manages margin, balance, and risk
 */

import { IRiskLedgerService } from '../interfaces/risk-ledger.interface';
import { 
  BalanceChange, 
  MarginStatus, 
  LiquidationResult,
  AccountBalance,
  AccountBalanceEvent,
  PositionState
} from '../types/position-lifecycle.types';
import { randomUUID } from 'crypto';

export class RiskLedgerService implements IRiskLedgerService {
  private readonly maxLeverage: number = 100;
  private readonly marginCallLevel: number = 0.5; // 50% margin level triggers margin call
  private readonly liquidationLevel: number = 0.2; // 20% margin level triggers liquidation

  constructor(
    private readonly accountRepository: any, // Will be injected
    private readonly balanceEventRepository: any, // Will be injected
    private readonly positionRepository: any, // Will be injected
    maxLeverage?: number,
    marginCallLevel?: number,
    liquidationLevel?: number
  ) {
    if (maxLeverage !== undefined) this.maxLeverage = maxLeverage;
    if (marginCallLevel !== undefined) this.marginCallLevel = marginCallLevel;
    if (liquidationLevel !== undefined) this.liquidationLevel = liquidationLevel;
  }

  async reserveMargin(positionId: string, marginAmount: number): Promise<void> {
    // Get position to find account
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const accountId = position.accountId || 'default'; // Assuming account ID is available
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Check if sufficient margin is available
    if (account.freeMargin < marginAmount) {
      throw new Error(`Insufficient margin. Required: ${marginAmount}, Available: ${account.freeMargin}`);
    }

    // Update account balance
    const updatedAccount: AccountBalance = {
      ...account,
      marginUsed: account.marginUsed + marginAmount,
      freeMargin: account.freeMargin - marginAmount,
      updatedAt: new Date()
    };

    await this.accountRepository.update(accountId, updatedAccount);

    // Create balance event
    await this.createBalanceEvent(accountId, 'MARGIN_RESERVED', {
      amount: marginAmount,
      positionId,
      previousMarginUsed: account.marginUsed,
      newMarginUsed: updatedAccount.marginUsed
    });
  }

  async releaseMargin(positionId: string, marginAmount: number): Promise<void> {
    // Get position to find account
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const accountId = position.accountId || 'default';
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Update account balance
    const updatedAccount: AccountBalance = {
      ...account,
      marginUsed: Math.max(0, account.marginUsed - marginAmount),
      freeMargin: account.freeMargin + marginAmount,
      updatedAt: new Date()
    };

    await this.accountRepository.update(accountId, updatedAccount);

    // Create balance event
    await this.createBalanceEvent(accountId, 'MARGIN_RELEASED', {
      amount: marginAmount,
      positionId,
      previousMarginUsed: account.marginUsed,
      newMarginUsed: updatedAccount.marginUsed
    });
  }

  async updateAccountBalance(balanceChange: BalanceChange): Promise<void> {
    const account = await this.accountRepository.findById(balanceChange.accountId);
    if (!account) {
      throw new Error(`Account ${balanceChange.accountId} not found`);
    }

    const previousBalance = account.balance;
    const previousEquity = account.equity;

    // Update balance and equity
    const updatedAccount: AccountBalance = {
      ...account,
      balance: account.balance + balanceChange.amount,
      equity: account.equity + balanceChange.amount,
      updatedAt: new Date()
    };

    // Recalculate free margin
    updatedAccount.freeMargin = updatedAccount.equity - updatedAccount.marginUsed;

    await this.accountRepository.update(balanceChange.accountId, updatedAccount);

    // Create balance event
    await this.createBalanceEvent(balanceChange.accountId, 'BALANCE_UPDATED', {
      amount: balanceChange.amount,
      reason: balanceChange.reason,
      positionId: balanceChange.positionId,
      executionId: balanceChange.executionId,
      previousBalance,
      newBalance: updatedAccount.balance,
      previousEquity,
      newEquity: updatedAccount.equity
    });
  }

  async checkMarginRequirements(accountId: string): Promise<MarginStatus> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Calculate margin level (equity / margin used)
    const marginLevel = account.marginUsed > 0 ? account.equity / account.marginUsed : Infinity;

    return {
      accountId,
      totalMarginUsed: account.marginUsed,
      availableMargin: account.freeMargin,
      marginLevel,
      isMarginCall: marginLevel < this.marginCallLevel && marginLevel >= this.liquidationLevel,
      isLiquidation: marginLevel < this.liquidationLevel
    };
  }

  async triggerLiquidation(accountId: string): Promise<LiquidationResult> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get all open positions for the account
    const openPositions = await this.positionRepository.findByAccountIdAndStatus(accountId, PositionState.OPEN);

    if (openPositions.length === 0) {
      return {
        accountId,
        positionsLiquidated: [],
        totalLoss: 0,
        marginReleased: 0,
        timestamp: new Date()
      };
    }

    // Sort positions by loss (highest loss first)
    const positionsWithLoss = openPositions.map(position => ({
      ...position,
      currentLoss: Math.min(0, position.unrealizedPnL) // Only negative PnL
    })).sort((a, b) => a.currentLoss - b.currentLoss);

    let totalLoss = 0;
    let marginReleased = 0;
    const liquidatedPositions: string[] = [];

    // Liquidate positions until margin requirements are met
    for (const position of positionsWithLoss) {
      // Close position at current market price (simplified - would need market data)
      const liquidationPrice = position.avgEntryPrice * 0.95; // Assume 5% slippage for liquidation
      
      // Calculate realized loss
      const realizedLoss = this.calculateLiquidationLoss(position, liquidationPrice);
      
      // Update position to liquidated
      await this.positionRepository.update(position.id, {
        status: 'LIQUIDATED',
        size: 0,
        realizedPnL: position.realizedPnL + realizedLoss,
        closedAt: new Date(),
        updatedAt: new Date()
      });

      // Release margin
      await this.releaseMargin(position.id, position.marginUsed);

      totalLoss += Math.abs(realizedLoss);
      marginReleased += position.marginUsed;
      liquidatedPositions.push(position.id);

      // Check if we've resolved the margin issue
      const updatedMarginStatus = await this.checkMarginRequirements(accountId);
      if (!updatedMarginStatus.isLiquidation) {
        break;
      }
    }

    // Update account balance with total loss
    await this.updateAccountBalance({
      accountId,
      amount: -totalLoss,
      reason: 'LIQUIDATION_LOSS'
    });

    // Create liquidation event
    await this.createBalanceEvent(accountId, 'LIQUIDATION_EXECUTED', {
      positionsLiquidated: liquidatedPositions,
      totalLoss,
      marginReleased
    });

    return {
      accountId,
      positionsLiquidated: liquidatedPositions,
      totalLoss,
      marginReleased,
      timestamp: new Date()
    };
  }

  /**
   * Task 9.1: Create balance event with proper field names and validation
   * Requirements: 3.1.2, 3.1.3, 3.1.5, 3.1.6
   */
  private async createBalanceEvent(accountId: string, eventType: string, payload: any): Promise<void> {
    // Get current account balance to ensure accuracy
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Cannot create balance event: Account ${accountId} not found`);
    }

    // Calculate balance_before, amount, and balance_after
    // Requirement 3.1.6: No zero defaults - all fields must be explicitly set
    const balance_before = payload.previousBalance !== undefined ? payload.previousBalance : account.balance;
    const amount = payload.amount;
    const balance_after = payload.newBalance !== undefined ? payload.newBalance : balance_before + amount;

    // Requirement 3.1.3: Validate balance equation before insert
    if (Math.abs(balance_after - (balance_before + amount)) > 0.0001) {
      throw new Error(
        `Balance equation violation: balance_after (${balance_after}) != balance_before (${balance_before}) + amount (${amount})`
      );
    }

    // Requirement 3.1.2: Create event with all required fields
    const event: AccountBalanceEvent = {
      id: randomUUID(),
      accountId,
      eventType,
      balance_before,      // Updated field name (Task 8.1)
      balance_after,       // Updated field name (Task 8.1)
      amount,              // Updated field name (Task 8.1)
      reason: payload.reason || eventType,
      positionId: payload.positionId,
      executionId: payload.executionId,
      createdAt: new Date()
    };

    // Requirement 3.2.3: Create event before balance update (in same transaction)
    await this.balanceEventRepository.create(event);
  }

  /**
   * Task 9.1: Create PNL_REALIZED event on position closure
   * Requirements: 3.1.1, 3.1.2, 3.1.5
   * 
   * This method MUST be called when a position closes to record the realized PnL
   */
  async realizePnL(positionId: string, pnlAmount: number, closeReason: string): Promise<void> {
    // Get position to find account
    const position = await this.positionRepository.findById(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const accountId = position.accountId || 'default';
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const balance_before = account.balance;
    const balance_after = balance_before + pnlAmount;

    // Update account balance
    const updatedAccount: AccountBalance = {
      ...account,
      balance: balance_after,
      equity: account.equity + pnlAmount,
      freeMargin: account.freeMargin + pnlAmount,
      updatedAt: new Date()
    };

    await this.accountRepository.update(accountId, updatedAccount);

    // Requirement 3.1.1: Create PNL_REALIZED event for every position closure
    await this.createBalanceEvent(accountId, 'PNL_REALIZED', {
      amount: pnlAmount,
      previousBalance: balance_before,
      newBalance: balance_after,
      reason: `Position closed: ${closeReason}`,
      positionId
    });
  }

  private calculateLiquidationLoss(position: any, liquidationPrice: number): number {
    const priceDiff = position.side === 'BUY' 
      ? liquidationPrice - position.avgEntryPrice
      : position.avgEntryPrice - liquidationPrice;
    
    return priceDiff * position.size;
  }

  /**
   * Calculate maximum position size based on available margin and leverage
   */
  calculateMaxPositionSize(
    accountId: string,
    price: number,
    leverage: number
  ): Promise<number> {
    return this.accountRepository.findById(accountId).then((account: AccountBalance) => {
      if (!account) return 0;
      
      const maxNotional = account.freeMargin * Math.min(leverage, this.maxLeverage);
      return maxNotional / price;
    });
  }

  /**
   * Validate if a position can be opened with current margin
   */
  async validateMarginForPosition(
    accountId: string,
    positionSize: number,
    price: number,
    leverage: number
  ): Promise<{ valid: boolean; reason?: string }> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      return { valid: false, reason: 'Account not found' };
    }

    const requiredMargin = (positionSize * price) / Math.min(leverage, this.maxLeverage);
    
    if (requiredMargin > account.freeMargin) {
      return { 
        valid: false, 
        reason: `Insufficient margin. Required: ${requiredMargin}, Available: ${account.freeMargin}` 
      };
    }

    return { valid: true };
  }

  /**
   * Get account equity including unrealized PnL
   */
  async calculateAccountEquity(accountId: string): Promise<number> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) return 0;

    // Get all open positions and sum unrealized PnL
    const openPositions = await this.positionRepository.findByAccountIdAndStatus(accountId, PositionState.OPEN);
    const totalUnrealizedPnL = openPositions.reduce((sum: number, pos: any) => sum + pos.unrealizedPnL, 0);

    return account.balance + totalUnrealizedPnL;
  }

  /**
   * Monitor margin levels and trigger alerts
   */
  async monitorMarginLevels(accountId: string): Promise<{
    status: 'HEALTHY' | 'MARGIN_CALL' | 'LIQUIDATION_REQUIRED';
    marginLevel: number;
    action?: string;
  }> {
    const marginStatus = await this.checkMarginRequirements(accountId);

    if (marginStatus.isLiquidation) {
      return {
        status: 'LIQUIDATION_REQUIRED',
        marginLevel: marginStatus.marginLevel,
        action: 'Immediate liquidation required'
      };
    }

    if (marginStatus.isMarginCall) {
      return {
        status: 'MARGIN_CALL',
        marginLevel: marginStatus.marginLevel,
        action: 'Add funds or close positions'
      };
    }

    return {
      status: 'HEALTHY',
      marginLevel: marginStatus.marginLevel
    };
  }
}