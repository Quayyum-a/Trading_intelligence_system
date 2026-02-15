import { ManualAuditorService } from '../services/manual-auditor.service.js';
import { getLogger } from '../../config/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

async function runManualAudit() {
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('🔍 MANUAL LEDGER AUDIT');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');

  const auditor = new ManualAuditorService();

  try {
    const report = await auditor.performAudit();

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📊 AUDIT REPORT');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');

    // Event Coverage
    logger.info('📋 EVENT COVERAGE:');
    logger.info(`   Total Positions: ${report.coverage.totalPositions}`);
    logger.info(`   Complete Coverage: ${report.coverage.positionsWithCompleteEvents}`);
    logger.info(`   Missing Events: ${report.coverage.missingEvents.length}`);
    logger.info(`   Coverage: ${report.coverage.coveragePercentage.toFixed(2)}%`);
    
    if (report.coverage.missingEvents.length > 0) {
      logger.warn('');
      logger.warn('   ⚠️  Positions with missing events:');
      report.coverage.missingEvents.slice(0, 10).forEach(me => {
        logger.warn(`      - Position ${me.positionId} (${me.positionStatus}): Missing ${me.missingEventTypes.join(', ')}`);
      });
      if (report.coverage.missingEvents.length > 10) {
        logger.warn(`      ... and ${report.coverage.missingEvents.length - 10} more`);
      }
    }
    logger.info('');

    // Balance Equation
    logger.info('🧮 BALANCE EQUATION:');
    logger.info(`   Total Events: ${report.balanceCheck.totalEvents}`);
    logger.info(`   Valid Events: ${report.balanceCheck.validEvents}`);
    logger.info(`   Invalid Events: ${report.balanceCheck.invalidEvents.length}`);
    logger.info(`   Status: ${report.balanceCheck.passed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (report.balanceCheck.invalidEvents.length > 0) {
      logger.error('');
      logger.error('   ❌ Invalid balance events:');
      report.balanceCheck.invalidEvents.slice(0, 10).forEach(ie => {
        logger.error(`      - Event ${ie.eventId}: Expected ${ie.expected}, Got ${ie.actual} (Diff: ${ie.difference})`);
      });
      if (report.balanceCheck.invalidEvents.length > 10) {
        logger.error(`      ... and ${report.balanceCheck.invalidEvents.length - 10} more`);
      }
    }
    logger.info('');

    // Discrepancies
    logger.info('🔎 DISCREPANCIES:');
    logger.info(`   Total: ${report.discrepancies.length}`);
    
    const byType = {
      BALANCE_MISMATCH: report.discrepancies.filter(d => d.type === 'BALANCE_MISMATCH').length,
      MISSING_EVENT: report.discrepancies.filter(d => d.type === 'MISSING_EVENT').length,
      ORPHANED_EVENT: report.discrepancies.filter(d => d.type === 'ORPHANED_EVENT').length,
      PNL_MISMATCH: report.discrepancies.filter(d => d.type === 'PNL_MISMATCH').length
    };
    
    logger.info(`   Balance Mismatches: ${byType.BALANCE_MISMATCH}`);
    logger.info(`   Missing Events: ${byType.MISSING_EVENT}`);
    logger.info(`   Orphaned Events: ${byType.ORPHANED_EVENT}`);
    logger.info(`   PnL Mismatches: ${byType.PNL_MISMATCH}`);
    
    if (report.discrepancies.length > 0) {
      logger.error('');
      logger.error('   ❌ Discrepancy details:');
      report.discrepancies.slice(0, 10).forEach(d => {
        logger.error(`      - [${d.type}] ${d.entity}: Expected ${d.expected}, Got ${d.actual}`);
      });
      if (report.discrepancies.length > 10) {
        logger.error(`      ... and ${report.discrepancies.length - 10} more`);
      }
    }
    logger.info('');

    // Final Result
    logger.info('═══════════════════════════════════════════════════════════');
    if (report.passed) {
      logger.info('✅ AUDIT RESULT: PASSED');
      logger.info('');
      logger.info('🎉 All success criteria met:');
      logger.info('   ✅ Perfect event coverage (100%)');
      logger.info('   ✅ Perfect balance equation');
      logger.info('   ✅ Zero discrepancies');
      logger.info('   ✅ All PnL calculations match');
      logger.info('');
      logger.info('📋 NEXT STEPS:');
      logger.info('   1. Review detailed audit report');
      logger.info('   2. Proceed to Week 4: Live Capital Testing');
    } else {
      logger.error('❌ AUDIT RESULT: FAILED');
      logger.error('');
      logger.error('🚫 Failure reasons:');
      
      if (report.coverage.coveragePercentage < 100) {
        logger.error(`   ❌ Event coverage at ${report.coverage.coveragePercentage.toFixed(2)}% (100% required)`);
      }
      
      if (!report.balanceCheck.passed) {
        logger.error(`   ❌ Balance equation violated (${report.balanceCheck.invalidEvents.length} invalid events)`);
      }
      
      if (report.discrepancies.length > 0) {
        logger.error(`   ❌ ${report.discrepancies.length} discrepancies found`);
      }
      
      logger.error('');
      logger.error('📋 REQUIRED ACTIONS:');
      logger.error('   1. Investigate root cause of each discrepancy');
      logger.error('   2. Fix data integrity issues');
      logger.error('   3. Add validation to prevent recurrence');
      logger.error('   4. RESTART from Week 1 (72-hour test)');
    }
    logger.info('═══════════════════════════════════════════════════════════');

    // Save report
    const reportPath = path.join(process.cwd(), 'reports', `manual-audit-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.info(`📄 Full report saved to: ${reportPath}`);

    // Exit with appropriate code
    process.exit(report.passed ? 0 : 1);

  } catch (error) {
    logger.error('💥 Manual Audit Failed with Exception', error);
    process.exit(1);
  }
}

// Run the audit
runManualAudit();
