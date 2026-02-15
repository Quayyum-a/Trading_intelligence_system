/**
 * Generate Daily Discipline Report
 *
 * Run this every morning to see:
 * - Total interventions
 * - Days since last intervention
 * - Intervention-free streak
 * - Cost of emotions
 */

import { DisciplineGuardianService } from '../discipline-guardian.service.js';
import { getLogger } from '../../config/logger.js';

const logger = getLogger();

async function generateReport() {
  try {
    const guardian = new DisciplineGuardianService();
    const metrics = await guardian.generateDailyDisciplineReport();

    // Exit with status code based on discipline
    if (metrics.days_since_last_intervention > 30) {
      process.exit(0); // Perfect discipline
    } else if (metrics.days_since_last_intervention > 7) {
      process.exit(0); // Good discipline
    } else {
      process.exit(1); // Warning: recent intervention
    }
  } catch (error) {
    logger.error('Failed to generate discipline report', error);
    process.exit(1);
  }
}

generateReport();
