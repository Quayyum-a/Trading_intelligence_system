import type {
  RiskResult,
  QualificationResult,
  RREngineService,
  RRResult,
  LeverageCheck
} from './strategy.types.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class RREngineServiceImpl implements RREngineService {
  
  /**
   * Validate reward-to-risk ratio and leverage constraints
   */
  validateRR(risk: RiskResult, qualification: QualificationResult, currentPrice: number): RRResult {
    try {
      // Check if risk was approved
      if (!risk.approved || !qualification.qualified) {
        return this.createRejectedRR('Risk not approved or trade not qualified');
      }

      // Perform leverage and RR checks
      const checks = this.performLeverageChecks(risk, currentPrice);
      const rrRatio = qualification.rrRatio || 0;
      
      // Add RR ratio check
      const rrCheck = this.validateRRRatio(rrRatio);
      checks.push(rrCheck);

      const allChecksPassed = checks.every(check => check.passed);

      if (!allChecksPassed) {
        const failedChecks = checks.filter(check => !check.passed);
        const reasoning = `RR/Leverage checks failed: ${failedChecks.map(c => c.name).join(', ')}`;
        return this.createRejectedRR(reasoning, checks);
      }

      // Calculate margin requirements
      const marginRequired = this.calculateMarginRequired(risk.positionSize, currentPrice);
      const marginPercent = this.calculateMarginPercent(marginRequired, DEFAULT_STRATEGY_CONFIG.risk.accountBalance);
      const leverageUsed = this.calculateLeverageUsed(risk.positionSize, currentPrice, marginRequired);

      return {
        approved: true,
        rrRatio,
        marginRequired,
        marginPercent,
        leverageUsed,
        reasoning: `RR/Leverage approved: RR ${rrRatio.toFixed(2)}, Margin ${marginRequired.toFixed(2)}, Leverage ${leverageUsed.toFixed(1)}x`,
        checks
      };

    } catch (error) {
      return this.createRejectedRR(`RR validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Perform comprehensive leverage validation checks
   */
  private performLeverageChecks(risk: RiskResult, currentPrice: number): LeverageCheck[] {
    const checks: LeverageCheck[] = [];
    const config = DEFAULT_STRATEGY_CONFIG;

    // Calculate margin required
    const marginRequired = this.calculateMarginRequired(risk.positionSize, currentPrice);
    
    // Check 1: Margin calculation formula validation
    const expectedMargin = (risk.positionSize * currentPrice) / config.risk.leverage;
    const marginTolerance = expectedMargin * 0.001; // 0.1% tolerance
    checks.push({
      name: 'MARGIN_CALCULATION_FORMULA',
      passed: Math.abs(marginRequired - expectedMargin) <= marginTolerance,
      actual: marginRequired,
      limit: expectedMargin,
      description: 'Margin must be calculated using (Position Size × Price) / 200 formula'
    });

    // Check 2: Leverage limit (1:200)
    const leverageUsed = this.calculateLeverageUsed(risk.positionSize, currentPrice, marginRequired);
    checks.push({
      name: 'LEVERAGE_LIMIT',
      passed: leverageUsed <= config.risk.leverage,
      actual: leverageUsed,
      limit: config.risk.leverage,
      description: `Leverage must not exceed 1:${config.risk.leverage}`
    });

    // Check 3: Margin usage percentage
    const marginPercent = this.calculateMarginPercent(marginRequired, config.risk.accountBalance);
    const maxMarginUsage = 0.5; // 50% max margin usage for safety
    checks.push({
      name: 'MARGIN_USAGE_LIMIT',
      passed: marginPercent <= maxMarginUsage,
      actual: marginPercent,
      limit: maxMarginUsage,
      description: 'Margin usage must not exceed 50% of account balance'
    });

    // Check 4: Minimum margin requirement
    const minMargin = 10; // $10 minimum margin
    checks.push({
      name: 'MINIMUM_MARGIN_REQUIREMENT',
      passed: marginRequired >= minMargin,
      actual: marginRequired,
      limit: minMargin,
      description: 'Margin requirement must meet minimum threshold'
    });

    // Check 5: Position size validation for leverage
    const maxPositionForLeverage = (config.risk.accountBalance * 0.5 * config.risk.leverage) / currentPrice;
    checks.push({
      name: 'POSITION_SIZE_LEVERAGE_LIMIT',
      passed: risk.positionSize <= maxPositionForLeverage,
      actual: risk.positionSize,
      limit: maxPositionForLeverage,
      description: 'Position size must be within leverage constraints'
    });

    return checks;
  }

  /**
   * Validate reward-to-risk ratio meets minimum threshold
   */
  private validateRRRatio(rrRatio: number): LeverageCheck {
    const minRR = DEFAULT_STRATEGY_CONFIG.risk.minRRRatio;
    
    return {
      name: 'RR_RATIO_MINIMUM',
      passed: rrRatio >= minRR,
      actual: rrRatio,
      limit: minRR,
      description: `Reward-to-risk ratio must be at least ${minRR}:1`
    };
  }

  /**
   * Calculate margin required using 1:200 leverage formula
   */
  private calculateMarginRequired(positionSize: number, currentPrice: number): number {
    const leverage = DEFAULT_STRATEGY_CONFIG.risk.leverage;
    
    // Margin = (Position Size × Price) / Leverage
    const marginRequired = (positionSize * currentPrice) / leverage;
    
    return Math.round(marginRequired * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate margin usage as percentage of account balance
   */
  private calculateMarginPercent(marginRequired: number, accountBalance: number): number {
    if (accountBalance <= 0) {
      return 1; // 100% if no account balance
    }
    
    return marginRequired / accountBalance;
  }

  /**
   * Calculate actual leverage used
   */
  private calculateLeverageUsed(positionSize: number, currentPrice: number, marginRequired: number): number {
    if (marginRequired <= 0) {
      return 0;
    }
    
    const notionalValue = positionSize * currentPrice;
    return notionalValue / marginRequired;
  }

  /**
   * Validate that leverage never exceeds 1:200
   */
  private validateLeverageConstraint(positionSize: number, currentPrice: number, accountBalance: number): boolean {
    const notionalValue = positionSize * currentPrice;
    const maxLeverage = DEFAULT_STRATEGY_CONFIG.risk.leverage;
    const minMarginRequired = notionalValue / maxLeverage;
    
    // Ensure we have enough margin
    return minMarginRequired <= accountBalance * 0.5; // Use max 50% of account for margin
  }

  /**
   * Calculate maximum position size within leverage constraints
   */
  calculateMaxPositionSizeForLeverage(currentPrice: number, accountBalance: number): number {
    const maxLeverage = DEFAULT_STRATEGY_CONFIG.risk.leverage;
    const maxMarginUsage = 0.5; // 50% max margin usage
    const availableMargin = accountBalance * maxMarginUsage;
    
    // Max Position Size = (Available Margin × Leverage) / Current Price
    const maxPositionSize = (availableMargin * maxLeverage) / currentPrice;
    
    return Math.round(maxPositionSize * 10000) / 10000;
  }

  /**
   * Validate margin requirements against account balance
   */
  private validateMarginRequirements(marginRequired: number, accountBalance: number): boolean {
    // Must have sufficient account balance
    if (marginRequired > accountBalance) {
      return false;
    }

    // Should not use more than 50% of account for margin
    const marginPercent = marginRequired / accountBalance;
    if (marginPercent > 0.5) {
      return false;
    }

    return true;
  }

  /**
   * Calculate free margin after trade
   */
  calculateFreeMargin(accountBalance: number, usedMargin: number): number {
    return Math.max(0, accountBalance - usedMargin);
  }

  /**
   * Calculate margin level percentage
   */
  calculateMarginLevel(accountBalance: number, usedMargin: number): number {
    if (usedMargin <= 0) {
      return Infinity;
    }
    
    return (accountBalance / usedMargin) * 100;
  }

  /**
   * Validate margin level is above minimum threshold
   */
  private validateMarginLevel(accountBalance: number, usedMargin: number): boolean {
    const marginLevel = this.calculateMarginLevel(accountBalance, usedMargin);
    const minMarginLevel = 200; // 200% minimum margin level
    
    return marginLevel >= minMarginLevel;
  }

  /**
   * Create rejected RR result
   */
  private createRejectedRR(reasoning: string, checks: LeverageCheck[] = []): RRResult {
    return {
      approved: false,
      rrRatio: 0,
      marginRequired: 0,
      marginPercent: 0,
      leverageUsed: 0,
      reasoning,
      checks
    };
  }

  /**
   * Calculate optimal position size considering both risk and leverage constraints
   */
  calculateOptimalPositionSize(
    riskAmount: number, 
    stopDistance: number, 
    currentPrice: number, 
    accountBalance: number
  ): number {
    // Risk-based position size
    const riskBasedSize = riskAmount / stopDistance;
    
    // Leverage-based maximum position size
    const leverageBasedMaxSize = this.calculateMaxPositionSizeForLeverage(currentPrice, accountBalance);
    
    // Use the smaller of the two to ensure both constraints are met
    const optimalSize = Math.min(riskBasedSize, leverageBasedMaxSize);
    
    return Math.round(optimalSize * 10000) / 10000;
  }

  /**
   * Validate all leverage constraints are satisfied
   */
  validateAllLeverageConstraints(
    positionSize: number, 
    currentPrice: number, 
    accountBalance: number
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];
    
    // Check margin calculation
    const marginRequired = this.calculateMarginRequired(positionSize, currentPrice);
    if (marginRequired > accountBalance * 0.5) {
      violations.push('Margin requirement exceeds 50% of account balance');
    }
    
    // Check leverage limit
    const leverageUsed = this.calculateLeverageUsed(positionSize, currentPrice, marginRequired);
    if (leverageUsed > DEFAULT_STRATEGY_CONFIG.risk.leverage) {
      violations.push(`Leverage ${leverageUsed.toFixed(1)}x exceeds limit of ${DEFAULT_STRATEGY_CONFIG.risk.leverage}x`);
    }
    
    // Check margin level
    if (!this.validateMarginLevel(accountBalance, marginRequired)) {
      violations.push('Margin level below minimum threshold');
    }
    
    return {
      valid: violations.length === 0,
      violations
    };
  }
}