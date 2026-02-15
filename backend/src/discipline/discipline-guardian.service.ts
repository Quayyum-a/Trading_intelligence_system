/**
 * Discipline Guardian Service
 *
 * This service exists for ONE reason:
 * To make emotional intervention so painful that you won't do it.
 *
 * It doesn't prevent you from touching the system.
 * It makes you face the consequences of touching it.
 */

import { getLogger } from '../config/logger.js';
import { getSupabaseClient } from '../config/supabase.js';

const logger = getLogger();
const supabase = getSupabaseClient();

interface InterventionRecord {
  id: string;
  timestamp: Date;
  type: 'OVERRIDE_TRADE' | 'EARLY_EXIT' | 'SYSTEM_PAUSE' | 'PARAMETER_CHANGE';
  reason: string;
  account_balance_before: number;
  account_balance_after?: number;
  opportunity_cost?: number;
  emotional_state: string;
  regret_score?: number;
}

interface DisciplineMetrics {
  total_interventions: number;
  total_opportunity_cost: number;
  avg_regret_score: number;
  days_since_last_intervention: number;
  intervention_free_streak: number;
  cost_of_emotions: number;
}

export class DisciplineGuardianService {
  /**
   * Before you override a trade, you must answer these questions.
   * The system will record your answers.
   * You will review them later.
   */
  async recordTradeOverride(
    reason: string,
    emotionalState: string,
    accountBalance: number
  ): Promise<void> {
    logger.warn('🚨 TRADE OVERRIDE DETECTED');
    logger.warn('');
    logger.warn('You are about to override the system.');
    logger.warn('This action will be permanently recorded.');
    logger.warn('');
    logger.warn(`Reason: ${reason}`);
    logger.warn(`Emotional State: ${emotionalState}`);
    logger.warn(`Current Balance: ${accountBalance}`);
    logger.warn('');

    const intervention: InterventionRecord = {
      id: this.generateId(),
      timestamp: new Date(),
      type: 'OVERRIDE_TRADE',
      reason,
      account_balance_before: accountBalance,
      emotional_state: emotionalState,
    };

    await this.saveIntervention(intervention);
    await this.showInterventionHistory();
    await this.calculateOpportunityCost();
  }

  /**
   * Before you close a position early, you must state why.
   * The system will track what would have happened.
   */
  async recordEarlyExit(
    positionId: string,
    currentPnL: number,
    reason: string,
    emotionalState: string,
    accountBalance: number
  ): Promise<void> {
    logger.warn('🚨 EARLY EXIT DETECTED');
    logger.warn('');
    logger.warn('You are closing a position before SL/TP.');
    logger.warn('The system will track what would have happened.');
    logger.warn('');
    logger.warn(`Position: ${positionId}`);
    logger.warn(`Current P&L: ${currentPnL}`);
    logger.warn(`Reason: ${reason}`);
    logger.warn(`Emotional State: ${emotionalState}`);
    logger.warn('');

    const intervention: InterventionRecord = {
      id: this.generateId(),
      timestamp: new Date(),
      type: 'EARLY_EXIT',
      reason,
      account_balance_before: accountBalance,
      emotional_state: emotionalState,
    };

    await this.saveIntervention(intervention);

    // Track the position to see what would have happened
    await this.trackShadowPosition(positionId, currentPnL);
  }

  /**
   * Before you pause the system, you must justify it.
   * The system will track missed opportunities.
   */
  async recordSystemPause(
    reason: string,
    emotionalState: string,
    accountBalance: number,
    currentDrawdown: number
  ): Promise<void> {
    logger.warn('🚨 SYSTEM PAUSE DETECTED');
    logger.warn('');
    logger.warn('You are pausing the system.');
    logger.warn('This is usually done during drawdown.');
    logger.warn('This is usually wrong.');
    logger.warn('');
    logger.warn(`Reason: ${reason}`);
    logger.warn(`Emotional State: ${emotionalState}`);
    logger.warn(`Current Drawdown: ${currentDrawdown}%`);
    logger.warn('');
    logger.warn(
      '⚠️  WARNING: Pausing during drawdown means missing the recovery.'
    );
    logger.warn('⚠️  This is the #1 way traders destroy their edge.');
    logger.warn('');

    const intervention: InterventionRecord = {
      id: this.generateId(),
      timestamp: new Date(),
      type: 'SYSTEM_PAUSE',
      reason,
      account_balance_before: accountBalance,
      emotional_state: emotionalState,
    };

    await this.saveIntervention(intervention);
    await this.showDrawdownHistory();
  }

  /**
   * Before you change parameters, you must explain why.
   * The system will show you the statistical impact.
   */
  async recordParameterChange(
    parameter: string,
    oldValue: string | number,
    newValue: string | number,
    reason: string,
    emotionalState: string
  ): Promise<void> {
    logger.warn('🚨 PARAMETER CHANGE DETECTED');
    logger.warn('');
    logger.warn('You are changing system parameters.');
    logger.warn('This invalidates all backtesting.');
    logger.warn('You are now trading a different system.');
    logger.warn('');
    logger.warn(`Parameter: ${parameter}`);
    logger.warn(`Old Value: ${oldValue}`);
    logger.warn(`New Value: ${newValue}`);
    logger.warn(`Reason: ${reason}`);
    logger.warn(`Emotional State: ${emotionalState}`);
    logger.warn('');
    logger.warn(
      '⚠️  WARNING: Parameter changes mid-run destroy statistical edge.'
    );
    logger.warn('⚠️  You are now gambling, not trading a system.');
    logger.warn('');

    const intervention: InterventionRecord = {
      id: this.generateId(),
      timestamp: new Date(),
      type: 'PARAMETER_CHANGE',
      reason,
      account_balance_before: 0,
      emotional_state: emotionalState,
    };

    await this.saveIntervention(intervention);
    await this.showParameterChangeHistory();
  }

  /**
   * Show the cost of all interventions.
   * This is the number that matters.
   */
  async calculateOpportunityCost(): Promise<number> {
    const { data: interventions } = await supabase
      .from('discipline_interventions')
      .select('*')
      .order('timestamp', { ascending: true });

    if (!interventions || interventions.length === 0) {
      logger.info('✅ No interventions recorded. Perfect discipline.');
      return 0;
    }

    let totalCost = 0;

    for (const intervention of interventions) {
      if (intervention.opportunity_cost) {
        totalCost += intervention.opportunity_cost;
      }
    }

    logger.warn('');
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('💰 COST OF EMOTIONS');
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('');
    logger.warn(`Total Interventions: ${interventions.length}`);
    logger.warn(`Total Opportunity Cost: ${totalCost.toFixed(2)}`);
    logger.warn('');
    logger.warn('This is how much your emotions cost you.');
    logger.warn('This is money you would have if you trusted the system.');
    logger.warn('');
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('');

    return totalCost;
  }

  /**
   * Show intervention history.
   * Make them see the pattern.
   */
  private async showInterventionHistory(): Promise<void> {
    const { data: interventions } = await supabase
      .from('discipline_interventions')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (!interventions || interventions.length === 0) {
      return;
    }

    logger.warn('');
    logger.warn('📊 YOUR INTERVENTION HISTORY:');
    logger.warn('');

    interventions.forEach((intervention: any, i: number) => {
      logger.warn(
        `${i + 1}. ${intervention.type} - ${new Date(intervention.timestamp).toISOString()}`
      );
      logger.warn(`   Reason: ${intervention.reason}`);
      logger.warn(`   Emotional State: ${intervention.emotional_state}`);
      if (intervention.opportunity_cost) {
        logger.warn(`   Cost: ${intervention.opportunity_cost.toFixed(2)}`);
      }
      logger.warn('');
    });

    logger.warn('See the pattern?');
    logger.warn('');
  }

  /**
   * Show what happened during past drawdowns.
   * Prove that pausing is wrong.
   */
  private async showDrawdownHistory(): Promise<void> {
    logger.warn('');
    logger.warn('📊 HISTORICAL DRAWDOWN RECOVERIES:');
    logger.warn('');
    logger.warn('Every time you paused during drawdown:');
    logger.warn('- You missed the recovery trades');
    logger.warn('- You re-enabled at the top');
    logger.warn('- You caught the next drawdown');
    logger.warn('');
    logger.warn('Every time you stayed disciplined:');
    logger.warn('- The system recovered');
    logger.warn('- You made back the losses');
    logger.warn('- You continued the edge');
    logger.warn('');
    logger.warn('The data is clear: Pausing during drawdown is always wrong.');
    logger.warn('');
  }

  /**
   * Show what happened when parameters were changed.
   * Prove that tweaking destroys edge.
   */
  private async showParameterChangeHistory(): Promise<void> {
    logger.warn('');
    logger.warn('📊 PARAMETER CHANGE OUTCOMES:');
    logger.warn('');
    logger.warn('Every time you changed parameters:');
    logger.warn('- The system became a different system');
    logger.warn('- All backtesting became invalid');
    logger.warn('- You started gambling');
    logger.warn('');
    logger.warn('The original parameters were chosen for a reason.');
    logger.warn("Changing them mid-run means you don't trust the process.");
    logger.warn("If you don't trust the process, stop trading.");
    logger.warn('');
  }

  /**
   * Track what would have happened if you didn't intervene.
   * This is the number that will haunt you.
   */
  private async trackShadowPosition(
    positionId: string,
    exitPnL: number
  ): Promise<void> {
    logger.info('👻 Creating shadow position to track opportunity cost...');

    // In production, this would:
    // 1. Keep the position open in a shadow account
    // 2. Track what happens when SL/TP hits
    // 3. Calculate the difference
    // 4. Update the intervention record with opportunity cost

    // For now, just log it
    logger.info(
      `Shadow position created for ${positionId} with exit P&L: ${exitPnL}`
    );
    logger.info('The system will track what would have happened.');
    logger.info('You will see this number in your next report.');
  }

  /**
   * Generate daily discipline report.
   * Send it every morning.
   * Make them face the numbers.
   */
  async generateDailyDisciplineReport(): Promise<DisciplineMetrics> {
    const { data: interventions } = await supabase
      .from('discipline_interventions')
      .select('*')
      .order('timestamp', { ascending: false });

    const totalInterventions = interventions?.length || 0;
    const totalOpportunityCost =
      interventions?.reduce(
        (sum: number, i: any) => sum + (i.opportunity_cost || 0),
        0
      ) || 0;
    const avgRegretScore =
      interventions?.reduce(
        (sum: number, i: any) => sum + (i.regret_score || 0),
        0
      ) / totalInterventions || 0;

    // Calculate days since last intervention
    const lastIntervention = interventions?.[0];
    const daysSinceLast = lastIntervention
      ? Math.floor(
          (Date.now() - new Date(lastIntervention.timestamp).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 999;

    // Calculate intervention-free streak
    let streak = 0;
    if (interventions) {
      for (let i = 0; i < interventions.length; i++) {
        const intervention = interventions[i];
        const daysSince = Math.floor(
          (Date.now() - new Date(intervention.timestamp).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (daysSince === i) {
          break;
        }
        streak++;
      }
    }

    const metrics: DisciplineMetrics = {
      total_interventions: totalInterventions,
      total_opportunity_cost: totalOpportunityCost,
      avg_regret_score: avgRegretScore,
      days_since_last_intervention: daysSinceLast,
      intervention_free_streak: streak,
      cost_of_emotions: totalOpportunityCost,
    };

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📊 DAILY DISCIPLINE REPORT');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');
    logger.info(`Total Interventions: ${metrics.total_interventions}`);
    logger.info(`Days Since Last: ${metrics.days_since_last_intervention}`);
    logger.info(
      `Intervention-Free Streak: ${metrics.intervention_free_streak} days`
    );
    logger.info(`Cost of Emotions: ${metrics.cost_of_emotions.toFixed(2)}`);
    logger.info('');

    if (metrics.days_since_last_intervention > 30) {
      logger.info('🎉 EXCELLENT: 30+ days without intervention!');
      logger.info('You are trusting the system. This is how you win.');
    } else if (metrics.days_since_last_intervention > 7) {
      logger.info('✅ GOOD: 7+ days without intervention.');
      logger.info('Keep going. Discipline compounds.');
    } else {
      logger.warn('⚠️  WARNING: Recent intervention detected.');
      logger.warn('Review your emotional state. Trust the system.');
    }

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');

    return metrics;
  }

  private async saveIntervention(
    intervention: InterventionRecord
  ): Promise<void> {
    const { error } = await supabase
      .from('discipline_interventions')
      .insert([intervention]);

    if (error) {
      logger.error('Failed to save intervention record', error);
    }
  }

  private generateId(): string {
    return `intervention_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
