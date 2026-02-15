/**
 * Calculate Opportunity Cost
 *
 * Shows the total cost of all emotional interventions.
 * This is the money you would have if you trusted the system.
 */

import { DisciplineGuardianService } from '../discipline-guardian.service.js';
import { getLogger } from '../../config/logger.js';

const logger = getLogger();

async function calculateCost() {
  try {
    const guardian = new DisciplineGuardianService();
    const cost = await guardian.calculateOpportunityCost();

    if (cost === 0) {
      logger.info('');
      logger.info('🎉 Perfect discipline! No opportunity cost.');
      logger.info('');
      process.exit(0);
    } else {
      logger.warn('');
      logger.warn(`💰 Total opportunity cost: $${cost.toFixed(2)}`);
      logger.warn('');
      logger.warn('This is what your emotions cost you.');
      logger.warn('');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Failed to calculate opportunity cost', error);
    process.exit(1);
  }
}

calculateCost();
