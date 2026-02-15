/**
 * Discipline Guardian Integration Example
 *
 * This shows how to integrate the Discipline Guardian into your trading services.
 * The key principle: Make intervention painful through accountability.
 */

import { DisciplineGuardianService } from '../discipline-guardian.service.js';
import { getLogger } from '../../config/logger.js';

const logger = getLogger();
const disciplineGuardian = new DisciplineGuardianService();

/**
 * Example 1: Manual Trade Override
 *
 * Before allowing a manual override, force the user to record why.
 */
export async function handleManualTradeOverride(
  signalId: string,
  reason: string,
  emotionalState: string,
  accountBalance: number
): Promise<boolean> {
  logger.info(`Manual override requested for signal: ${signalId}`);

  // Force accountability BEFORE allowing the override
  await disciplineGuardian.recordTradeOverride(
    reason,
    emotionalState,
    accountBalance
  );

  // Show the cost of past overrides
  await disciplineGuardian.calculateOpportunityCost();

  // Now allow the override (but they've seen the consequences)
  logger.warn('Override allowed. This action has been recorded.');

  return true;
}

/**
 * Example 2: Early Position Close
 *
 * Before closing a position early, track what would have happened.
 */
export async function handleEarlyPositionClose(
  positionId: string,
  currentPnL: number,
  reason: string,
  emotionalState: string,
  accountBalance: number
): Promise<void> {
  logger.info(`Early close requested for position: ${positionId}`);

  // Force accountability BEFORE closing
  await disciplineGuardian.recordEarlyExit(
    positionId,
    currentPnL,
    reason,
    emotionalState,
    accountBalance
  );

  // The system will now track what would have happened
  // When the SL/TP hits, it will calculate opportunity cost

  logger.warn('Position closed early. Shadow position created.');
  logger.warn('You will see the opportunity cost in your next report.');
}

/**
 * Example 3: System Pause During Drawdown
 *
 * Before pausing, show historical evidence that pausing is wrong.
 */
export async function handleSystemPause(
  reason: string,
  emotionalState: string,
  accountBalance: number,
  currentDrawdown: number
): Promise<void> {
  logger.info('System pause requested');

  // Force accountability BEFORE pausing
  await disciplineGuardian.recordSystemPause(
    reason,
    emotionalState,
    accountBalance,
    currentDrawdown
  );

  // Show historical drawdown recoveries
  // Prove that pausing during drawdown is always wrong

  logger.warn('System paused. This action has been recorded.');
  logger.warn('Historical data shows pausing during drawdown is always wrong.');
}

/**
 * Example 4: Parameter Change
 *
 * Before changing parameters, show that tweaking destroys edge.
 */
export async function handleParameterChange(
  parameter: string,
  oldValue: string | number,
  newValue: string | number,
  reason: string,
  emotionalState: string
): Promise<void> {
  logger.info(`Parameter change requested: ${parameter}`);

  // Force accountability BEFORE changing
  await disciplineGuardian.recordParameterChange(
    parameter,
    oldValue,
    newValue,
    reason,
    emotionalState
  );

  // Show parameter change history
  // Prove that tweaking destroys statistical edge

  logger.warn('Parameter changed. All backtesting is now invalid.');
  logger.warn('You are now trading a different system.');
}

/**
 * Example 5: Daily Cron Job
 *
 * Run this every morning at 8 AM to send the discipline report.
 */
export async function sendDailyDisciplineReport(): Promise<void> {
  logger.info('Generating daily discipline report...');

  const metrics = await disciplineGuardian.generateDailyDisciplineReport();

  // Send to email/Slack/Discord
  // await sendEmail(metrics);
  // await sendSlackMessage(metrics);

  if (metrics.days_since_last_intervention > 30) {
    logger.info('🎉 30+ days without intervention! Ready to scale.');
  } else if (metrics.days_since_last_intervention < 7) {
    logger.warn('⚠️  Recent intervention detected. Review your discipline.');
  }
}

/**
 * Example 6: Integration with Position Service
 *
 * This shows how to integrate into your existing position closure service.
 */
export class PositionServiceWithDiscipline {
  private disciplineGuardian = new DisciplineGuardianService();

  async closePosition(
    positionId: string,
    reason: 'SL_HIT' | 'TP_HIT' | 'MANUAL',
    accountBalance: number
  ): Promise<void> {
    if (reason === 'MANUAL') {
      // Manual close = early exit
      // Force accountability

      const currentPnL = await this.getCurrentPnL(positionId);

      await this.disciplineGuardian.recordEarlyExit(
        positionId,
        currentPnL,
        'Manual close requested',
        'Enter your emotional state',
        accountBalance
      );

      logger.warn('');
      logger.warn('⚠️  You are closing this position manually.');
      logger.warn('⚠️  The system will track what would have happened.');
      logger.warn('⚠️  You will see the opportunity cost in your next report.');
      logger.warn('');
    }

    // Proceed with the close
    await this.executeClose(positionId);
  }

  private async getCurrentPnL(positionId: string): Promise<number> {
    // Get current P&L from your position tracking
    return 0;
  }

  private async executeClose(positionId: string): Promise<void> {
    // Execute the actual close
    logger.info(`Position ${positionId} closed`);
  }
}

/**
 * Example 7: CLI Integration
 *
 * Add these commands to your CLI tool.
 */
export const disciplineCommands = {
  // Show daily report
  report: async () => {
    await disciplineGuardian.generateDailyDisciplineReport();
  },

  // Calculate opportunity cost
  cost: async () => {
    await disciplineGuardian.calculateOpportunityCost();
  },

  // Record manual intervention
  override: async (reason: string, emotionalState: string, balance: number) => {
    await disciplineGuardian.recordTradeOverride(reason, emotionalState, balance);
  },
};

/**
 * Example 8: Webhook Integration
 *
 * Send discipline reports to Slack/Discord.
 */
export async function sendDisciplineReportToSlack(
  webhookUrl: string
): Promise<void> {
  const metrics = await disciplineGuardian.generateDailyDisciplineReport();

  const message = {
    text: '📊 Daily Discipline Report',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Total Interventions:* ${metrics.total_interventions}\n*Days Since Last:* ${metrics.days_since_last_intervention}\n*Cost of Emotions:* $${metrics.cost_of_emotions.toFixed(2)}`,
        },
      },
    ],
  };

  // await fetch(webhookUrl, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(message),
  // });

  logger.info('Discipline report sent to Slack');
}

/**
 * The Key Principle:
 *
 * The Discipline Guardian doesn't prevent intervention.
 * It makes you face the consequences.
 *
 * Every intervention is recorded.
 * Every cost is calculated.
 * Every pattern is shown.
 *
 * The pain of seeing the cost prevents future intervention.
 */
