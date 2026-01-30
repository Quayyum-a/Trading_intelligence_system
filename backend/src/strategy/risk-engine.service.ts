import type {
  QualificationResult,
  RiskEngineService,
  RiskResult,
  RiskCheck
} from './strategy.types.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategy.config.js';

export class RiskEngineServiceImpl implements RiskEngineService {
  private activeTrades: number = 0; // Track concurrent trades

  /**
   * Calculate risk parameters and validate against limits
   */
  calculateRisk(qualification: QualificationResult, accountBalance: number): RiskResult {
    try {
      // Check if trade is qualified
      if (!qualification.qualified || !qualification.stopDistance) {
        return this.createRejectedRisk('Trade not qualified for risk calculation');
      }

      // Perform all risk checks
      const checks = this.performRiskChecks(qualification, accountBalance);
      const allChecksPassed = checks.every(check => check.passed);

      if (!allChecksPassed) {
        const failedChecks = checks.filter(check => !check.passed);
        const reasoning = `Risk checks failed: ${failedChecks.map(c => c.name).join(', ')}`;
        return this.createRejectedRisk(reasoning, checks);
      }

      // Calculate position parameters
      const riskPercent = DEFAULT_STRATEGY_CONFIG.risk.riskPerTrade;
      const riskAmount = accountBalance * riskPercent;
      const positionSize = this.calculatePositionSize(riskAmount, qualification.stopDistance);
      
      return {
        approved: true,
        riskPercent,
        riskAmount,
        positionSize,
        stopDistance: qualification.stopDistance,
        reasoning: `Risk approved: ${(riskPercent * 100).toFixed(1)}% risk, position size ${positionSize.toFixed(4)}`,
        checks
      };

    } catch (error) {
      return this.createRejectedRisk(`Risk calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Perform comprehensive risk validation checks
   */
  private performRiskChecks(qualification: QualificationResult, accountBalance: number): RiskCheck[] {
    const checks: RiskCheck[] = [];

    // Check 1: Risk percentage limit
    const riskPercent = DEFAULT_STRATEGY_CONFIG.risk.riskPerTrade;
    checks.push({
      name: 'RISK_PERCENTAGE_LIMIT',
      passed: riskPercent <= 0.01, // Exactly 1%
      actual: riskPercent,
      limit: 0.01,
      description: 'Risk per trade must not exceed 1%'
    });

    // Check 2: Account balance validation
    checks.push({
      name: 'ACCOUNT_BALANCE_VALID',
      passed: accountBalance > 0,
      actual: accountBalance,
      limit: 0,
      description: 'Account balance must be positive'
    });

    // Check 3: Stop distance validation
    const stopDistance = qualification.stopDistance || 0;
    const maxStopDistance = accountBalance * 0.05; // 5% of account as max stop
    checks.push({
      name: 'STOP_DISTANCE_REASONABLE',
      passed: stopDistance > 0 && stopDistance <= maxStopDistance,
      actual: stopDistance,
      limit: maxStopDistance,
      description: 'Stop distance must be positive and reasonable'
    });

    // Check 4: Position size validation
    const riskAmount = accountBalance * riskPercent;
    const positionSize = stopDistance > 0 ? riskAmount / stopDistance : 0;
    checks.push({
      name: 'POSITION_SIZE_VALID',
      passed: positionSize > 0,
      actual: positionSize,
      limit: 0,
      description: 'Position size must be positive'
    });

    // Check 5: Concurrent trades limit
    const maxConcurrentTrades = DEFAULT_STRATEGY_CONFIG.risk.maxConcurrentTrades;
    checks.push({
      name: 'CONCURRENT_TRADES_LIMIT',
      passed: this.activeTrades < maxConcurrentTrades,
      actual: this.activeTrades,
      limit: maxConcurrentTrades,
      description: `Maximum ${maxConcurrentTrades} concurrent trade(s) allowed`
    });

    // Check 6: Minimum position size
    const minPositionSize = 0.01; // Minimum lot size
    checks.push({
      name: 'MINIMUM_POSITION_SIZE',
      passed: positionSize >= minPositionSize,
      actual: positionSize,
      limit: minPositionSize,
      description: 'Position size must meet minimum lot size requirement'
    });

    // Check 7: Risk amount validation
    const maxRiskAmount = accountBalance * 0.02; // Never risk more than 2%
    checks.push({
      name: 'RISK_AMOUNT_LIMIT',
      passed: riskAmount <= maxRiskAmount,
      actual: riskAmount,
      limit: maxRiskAmount,
      description: 'Risk amount must not exceed maximum limit'
    });

    return checks;
  }

  /**
   * Calculate position size based on risk amount and stop distance
   */
  private calculatePositionSize(riskAmount: number, stopDistance: number): number {
    if (stopDistance <= 0) {
      return 0;
    }

    // Position Size = Risk Amount / Stop Distance
    const positionSize = riskAmount / stopDistance;
    
    // Round to appropriate precision (4 decimal places for forex)
    return Math.round(positionSize * 10000) / 10000;
  }

  /**
   * Validate position size against account constraints
   */
  private validatePositionSize(positionSize: number, accountBalance: number): boolean {
    // Check minimum position size
    if (positionSize < 0.01) {
      return false;
    }

    // Check maximum position size (shouldn't exceed reasonable limits)
    const maxPositionSize = accountBalance / 100; // Conservative limit
    if (positionSize > maxPositionSize) {
      return false;
    }

    return true;
  }

  /**
   * Calculate dollar risk for the trade
   */
  calculateDollarRisk(positionSize: number, stopDistance: number): number {
    return positionSize * stopDistance;
  }

  /**
   * Validate risk percentage is exactly 1%
   */
  private validateRiskPercentage(riskPercent: number): boolean {
    const targetRisk = DEFAULT_STRATEGY_CONFIG.risk.riskPerTrade;
    const tolerance = 0.0001; // Small tolerance for floating point precision
    
    return Math.abs(riskPercent - targetRisk) <= tolerance;
  }

  /**
   * Create rejected risk result
   */
  private createRejectedRisk(reasoning: string, checks: RiskCheck[] = []): RiskResult {
    return {
      approved: false,
      riskPercent: 0,
      riskAmount: 0,
      positionSize: 0,
      stopDistance: 0,
      reasoning,
      checks
    };
  }

  /**
   * Update active trades count (for concurrent trade tracking)
   */
  setActiveTrades(count: number): void {
    this.activeTrades = Math.max(0, count);
  }

  /**
   * Get current active trades count
   */
  getActiveTrades(): number {
    return this.activeTrades;
  }

  /**
   * Calculate maximum position size for account
   */
  calculateMaxPositionSize(accountBalance: number, leverage: number): number {
    // Conservative approach: never use more than 10% of account for margin
    const maxMarginUsage = accountBalance * 0.1;
    
    // Assuming XAU/USD at ~$2000/oz
    const estimatedPrice = 2000;
    const maxPositionSize = (maxMarginUsage * leverage) / estimatedPrice;
    
    return Math.round(maxPositionSize * 10000) / 10000;
  }

  /**
   * Validate risk parameters against configuration
   */
  private validateRiskConfiguration(): string[] {
    const errors: string[] = [];
    const config = DEFAULT_STRATEGY_CONFIG.risk;

    if (config.riskPerTrade <= 0 || config.riskPerTrade > 0.1) {
      errors.push('Risk per trade must be between 0 and 10%');
    }

    if (config.maxConcurrentTrades <= 0) {
      errors.push('Max concurrent trades must be positive');
    }

    if (config.leverage <= 0 || config.leverage > 500) {
      errors.push('Leverage must be between 1 and 500');
    }

    return errors;
  }

  /**
   * Calculate risk-adjusted position size with safety margins
   */
  calculateSafePositionSize(qualification: QualificationResult, accountBalance: number): number {
    if (!qualification.qualified || !qualification.stopDistance) {
      return 0;
    }

    const riskAmount = accountBalance * DEFAULT_STRATEGY_CONFIG.risk.riskPerTrade;
    const basePositionSize = riskAmount / qualification.stopDistance;
    
    // Apply safety margin (reduce position size by 5%)
    const safetyMargin = 0.95;
    const safePositionSize = basePositionSize * safetyMargin;
    
    return Math.round(safePositionSize * 10000) / 10000;
  }

  /**
   * Validate that calculated risk never exceeds 1%
   */
  validateExactRiskCompliance(positionSize: number, stopDistance: number, accountBalance: number): boolean {
    const actualRisk = (positionSize * stopDistance) / accountBalance;
    const targetRisk = DEFAULT_STRATEGY_CONFIG.risk.riskPerTrade;
    const tolerance = 0.0001;
    
    return Math.abs(actualRisk - targetRisk) <= tolerance;
  }
}