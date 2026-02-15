/**
 * Discipline Guardian Test
 *
 * Quick test to verify the Discipline Guardian service works correctly.
 */

import { DisciplineGuardianService } from './src/discipline/discipline-guardian.service.js';
import { getLogger } from './src/config/logger.js';

const logger = getLogger();

async function testDisciplineGuardian() {
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('🧪 DISCIPLINE GUARDIAN TEST');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');

  try {
    const guardian = new DisciplineGuardianService();

    // Test 1: Generate initial report (should show no interventions)
    logger.info('Test 1: Generate initial report...');
    const initialMetrics = await guardian.generateDailyDisciplineReport();
    logger.info(`✅ Initial metrics: ${initialMetrics.total_interventions} interventions`);
    logger.info('');

    // Test 2: Record a trade override
    logger.info('Test 2: Record trade override...');
    await guardian.recordTradeOverride(
      'Testing the system',
      'Curious, testing functionality',
      10000
    );
    logger.info('✅ Trade override recorded');
    logger.info('');

    // Test 3: Record an early exit
    logger.info('Test 3: Record early exit...');
    await guardian.recordEarlyExit(
      'test_position_123',
      -47,
      'Testing early exit tracking',
      'Testing, not emotional',
      9953
    );
    logger.info('✅ Early exit recorded');
    logger.info('');

    // Test 4: Record a system pause
    logger.info('Test 4: Record system pause...');
    await guardian.recordSystemPause(
      'Testing pause functionality',
      'Testing, not scared',
      9953,
      3.5
    );
    logger.info('✅ System pause recorded');
    logger.info('');

    // Test 5: Record a parameter change
    logger.info('Test 5: Record parameter change...');
    await guardian.recordParameterChange(
      'stop_loss_pips',
      50,
      40,
      'Testing parameter change tracking',
      'Testing, not frustrated'
    );
    logger.info('✅ Parameter change recorded');
    logger.info('');

    // Test 6: Calculate opportunity cost
    logger.info('Test 6: Calculate opportunity cost...');
    const cost = await guardian.calculateOpportunityCost();
    logger.info(`✅ Opportunity cost calculated: $${cost.toFixed(2)}`);
    logger.info('');

    // Test 7: Generate final report
    logger.info('Test 7: Generate final report...');
    const finalMetrics = await guardian.generateDailyDisciplineReport();
    logger.info(`✅ Final metrics: ${finalMetrics.total_interventions} interventions`);
    logger.info('');

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('✅ ALL TESTS PASSED');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');
    logger.info('The Discipline Guardian is working correctly.');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Run: npm run migrate:discipline');
    logger.info('2. Integrate into your trading services');
    logger.info('3. Set up daily cron job for reports');
    logger.info('4. Start tracking interventions');
    logger.info('');

    process.exit(0);
  } catch (error) {
    logger.error('');
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('❌ TEST FAILED');
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('');
    logger.error(error);
    logger.error('');
    logger.error('Make sure you have:');
    logger.error('1. Run: npm run migrate:discipline');
    logger.error('2. Set up Supabase credentials in .env');
    logger.error('3. Created the discipline tables');
    logger.error('');
    process.exit(1);
  }
}

testDisciplineGuardian();
