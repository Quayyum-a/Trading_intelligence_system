/**
 * Show Intervention History
 *
 * Displays the last 20 interventions with:
 * - Type (override, early exit, pause, parameter change)
 * - Timestamp
 * - Reason
 * - Emotional state
 * - Opportunity cost
 */

import { getSupabaseClient } from '../../config/supabase.js';
import { getLogger } from '../../config/logger.js';

const logger = getLogger();
const supabase = getSupabaseClient();

async function showHistory() {
  try {
    const { data: interventions, error } = await supabase
      .from('discipline_interventions')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    if (!interventions || interventions.length === 0) {
      logger.info('');
      logger.info('✅ No interventions recorded. Perfect discipline!');
      logger.info('');
      process.exit(0);
      return;
    }

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📊 INTERVENTION HISTORY');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');
    logger.info(`Total Interventions: ${interventions.length}`);
    logger.info('');

    interventions.forEach((intervention: any, i: number) => {
      logger.info(`${i + 1}. ${intervention.type}`);
      logger.info(`   Date: ${new Date(intervention.timestamp).toLocaleString()}`);
      logger.info(`   Reason: ${intervention.reason}`);
      logger.info(`   Emotional State: ${intervention.emotional_state}`);
      if (intervention.opportunity_cost) {
        logger.info(`   Cost: $${intervention.opportunity_cost.toFixed(2)}`);
      }
      logger.info('');
    });

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');

    // Calculate summary stats
    const totalCost = interventions.reduce(
      (sum: number, i: any) => sum + (i.opportunity_cost || 0),
      0
    );
    const overrides = interventions.filter(
      (i: any) => i.type === 'OVERRIDE_TRADE'
    ).length;
    const earlyExits = interventions.filter(
      (i: any) => i.type === 'EARLY_EXIT'
    ).length;
    const pauses = interventions.filter(
      (i: any) => i.type === 'SYSTEM_PAUSE'
    ).length;
    const paramChanges = interventions.filter(
      (i: any) => i.type === 'PARAMETER_CHANGE'
    ).length;

    logger.info('📈 SUMMARY:');
    logger.info('');
    logger.info(`Total Cost: $${totalCost.toFixed(2)}`);
    logger.info(`Trade Overrides: ${overrides}`);
    logger.info(`Early Exits: ${earlyExits}`);
    logger.info(`System Pauses: ${pauses}`);
    logger.info(`Parameter Changes: ${paramChanges}`);
    logger.info('');

    if (totalCost > 0) {
      logger.warn('⚠️  Your emotions are costing you money.');
      logger.warn('Trust the system.');
      logger.warn('');
    }

    process.exit(0);
  } catch (error) {
    logger.error('Failed to show intervention history', error);
    process.exit(1);
  }
}

showHistory();
