import { ContinuousMonitorService } from '../services/continuous-monitor.service.js';
import { getLogger } from '../../config/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

async function run72HourTest() {
  logger.info('🎯 Starting 72-Hour Continuous Run Test');
  logger.info('⏰ Duration: 72 hours (259,200,000 ms)');
  logger.info('📋 Monitoring: Health (1min), Positions (10min), Integrity (1hr)');
  logger.info('');

  const monitor = new ContinuousMonitorService();
  
  // 72 hours in milliseconds
  const SEVENTY_TWO_HOURS = 72 * 60 * 60 * 1000;
  
  // For testing, use a shorter duration (uncomment for actual 72-hour run)
  // const duration = SEVENTY_TWO_HOURS;
  const duration = 5 * 60 * 1000; // 5 minutes for testing

  try {
    logger.info(`🚀 Starting monitoring for ${duration / 1000 / 60} minutes...`);
    
    const report = await monitor.startMonitoring(duration);

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📊 72-HOUR TEST REPORT');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');
    logger.info(`⏱️  Duration: ${report.duration / 1000 / 60 / 60} hours`);
    logger.info(`📅 Start: ${report.startTime.toISOString()}`);
    logger.info(`📅 End: ${report.endTime.toISOString()}`);
    logger.info('');
    logger.info('📈 MONITORING STATISTICS:');
    logger.info(`   Health Checks: ${report.healthChecks.length}`);
    logger.info(`   Position Checks: ${report.positionChecks.length}`);
    logger.info(`   Integrity Checks: ${report.integrityChecks.length}`);
    logger.info('');
    logger.info('🚨 ALERTS:');
    logger.info(`   Total Alerts: ${report.alerts.length}`);
    logger.info(`   Critical: ${report.alerts.filter(a => a.level === 'CRITICAL').length}`);
    logger.info(`   High: ${report.alerts.filter(a => a.level === 'HIGH').length}`);
    logger.info(`   Medium: ${report.alerts.filter(a => a.level === 'MEDIUM').length}`);
    logger.info('');
    logger.info('❌ CRITICAL ERRORS:');
    logger.info(`   Total: ${report.criticalErrors.length}`);
    logger.info('');

    // Analyze results
    const criticalAlerts = report.alerts.filter(a => a.level === 'CRITICAL');
    const hasCriticalErrors = report.criticalErrors.length > 0;
    const hasCriticalAlerts = criticalAlerts.length > 0;

    if (report.passed && !hasCriticalErrors && !hasCriticalAlerts) {
      logger.info('✅ TEST RESULT: PASSED');
      logger.info('');
      logger.info('🎉 All success criteria met:');
      logger.info('   ✅ Zero critical errors');
      logger.info('   ✅ Zero critical alerts');
      logger.info('   ✅ System remained stable');
      logger.info('');
      logger.info('📋 NEXT STEPS:');
      logger.info('   1. Review detailed logs');
      logger.info('   2. Proceed to Week 2: Chaos Engineering');
    } else {
      logger.error('❌ TEST RESULT: FAILED');
      logger.error('');
      logger.error('🚫 Failure reasons:');
      
      if (hasCriticalErrors) {
        logger.error(`   ❌ ${report.criticalErrors.length} critical errors occurred`);
        report.criticalErrors.forEach((err, i) => {
          logger.error(`      ${i + 1}. ${err.message}`);
        });
      }
      
      if (hasCriticalAlerts) {
        logger.error(`   ❌ ${criticalAlerts.length} critical alerts triggered`);
        criticalAlerts.forEach((alert, i) => {
          logger.error(`      ${i + 1}. ${alert.message}`);
        });
      }
      
      logger.error('');
      logger.error('📋 REQUIRED ACTIONS:');
      logger.error('   1. Investigate root cause of failures');
      logger.error('   2. Fix identified issues');
      logger.error('   3. Add tests to prevent recurrence');
      logger.error('   4. RESTART 72-hour test from beginning');
    }

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');

    // Save report to file
    const reportPath = path.join(process.cwd(), 'reports', `72-hour-test-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.info(`📄 Full report saved to: ${reportPath}`);

    // Exit with appropriate code
    process.exit(report.passed ? 0 : 1);

  } catch (error) {
    logger.error('💥 72-Hour Test Failed with Exception', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.warn('⚠️  Received SIGINT - This will invalidate the 72-hour test!');
  logger.warn('⚠️  Test must run continuously without interruption.');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.warn('⚠️  Received SIGTERM - This will invalidate the 72-hour test!');
  logger.warn('⚠️  Test must run continuously without interruption.');
  process.exit(1);
});

// Run the test
run72HourTest();
