/**
 * Phase 7 Verification Script
 * 
 * This script verifies that all Phase 7 components are properly structured
 * and can be imported/executed without errors.
 */

import { getLogger } from './src/config/logger.js';

const logger = getLogger();

async function verifyPhase7() {
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('🔍 PHASE 7 VERIFICATION');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');

  let allPassed = true;

  // Test 1: Import Continuous Monitor Service
  try {
    logger.info('📦 Test 1: Importing ContinuousMonitorService...');
    const { ContinuousMonitorService } = await import('./src/war-testing/services/continuous-monitor.service.js');
    const monitor = new ContinuousMonitorService();
    logger.info('   ✅ ContinuousMonitorService imported and instantiated');
  } catch (error) {
    logger.error('   ❌ Failed to import ContinuousMonitorService:', error);
    allPassed = false;
  }

  // Test 2: Import Chaos Engineer Service
  try {
    logger.info('📦 Test 2: Importing ChaosEngineerService...');
    const { ChaosEngineerService } = await import('./src/war-testing/services/chaos-engineer.service.js');
    const engineer = new ChaosEngineerService();
    logger.info('   ✅ ChaosEngineerService imported and instantiated');
  } catch (error) {
    logger.error('   ❌ Failed to import ChaosEngineerService:', error);
    allPassed = false;
  }

  // Test 3: Import Manual Auditor Service
  try {
    logger.info('📦 Test 3: Importing ManualAuditorService...');
    const { ManualAuditorService } = await import('./src/war-testing/services/manual-auditor.service.js');
    const auditor = new ManualAuditorService();
    logger.info('   ✅ ManualAuditorService imported and instantiated');
  } catch (error) {
    logger.error('   ❌ Failed to import ManualAuditorService:', error);
    allPassed = false;
  }

  // Test 4: Import Live Capital Monitor Service
  try {
    logger.info('📦 Test 4: Importing LiveCapitalMonitorService...');
    const { LiveCapitalMonitorService } = await import('./src/war-testing/services/live-capital-monitor.service.js');
    const liveMonitor = new LiveCapitalMonitorService();
    logger.info('   ✅ LiveCapitalMonitorService imported and instantiated');
  } catch (error) {
    logger.error('   ❌ Failed to import LiveCapitalMonitorService:', error);
    allPassed = false;
  }

  // Test 5: Quick functional test
  try {
    logger.info('🧪 Test 5: Running quick functional test...');
    const { ContinuousMonitorService } = await import('./src/war-testing/services/continuous-monitor.service.js');
    const monitor = new ContinuousMonitorService();
    
    // Run for 10 seconds
    const report = await monitor.startMonitoring(10000);
    
    if (report.healthChecks.length > 0) {
      logger.info(`   ✅ Functional test passed (${report.healthChecks.length} health checks completed)`);
    } else {
      logger.warn('   ⚠️  Functional test completed but no health checks recorded');
    }
  } catch (error) {
    logger.error('   ❌ Functional test failed:', error);
    allPassed = false;
  }

  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════');
  
  if (allPassed) {
    logger.info('✅ VERIFICATION RESULT: ALL TESTS PASSED');
    logger.info('');
    logger.info('🎉 Phase 7 is properly structured and ready for execution!');
    logger.info('');
    logger.info('📋 NEXT STEPS:');
    logger.info('   1. Run individual tests:');
    logger.info('      - npm run test:72-hour');
    logger.info('      - npm run test:chaos');
    logger.info('      - npm run test:audit');
    logger.info('   2. Or run all tests: npm run test:phase-7');
    logger.info('');
    process.exit(0);
  } else {
    logger.error('❌ VERIFICATION RESULT: SOME TESTS FAILED');
    logger.error('');
    logger.error('Please review the errors above and fix any issues.');
    logger.error('');
    process.exit(1);
  }
}

// Run verification
verifyPhase7().catch(error => {
  logger.error('💥 Verification failed with exception:', error);
  process.exit(1);
});
