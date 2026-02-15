import { ChaosEngineerService, type ChaosScenario } from '../services/chaos-engineer.service.js';
import { getLogger } from '../../config/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger();

const CHAOS_SCENARIOS: ChaosScenario[] = [
  // Process Kill Scenarios
  {
    name: 'Scenario 1: Kill During Trade Open',
    type: 'PROCESS_KILL',
    timing: 'DURING_OPEN',
    description: 'Kill process while opening a position'
  },
  {
    name: 'Scenario 2: Kill During Trade Close',
    type: 'PROCESS_KILL',
    timing: 'DURING_CLOSE',
    description: 'Kill process while closing a position'
  },
  {
    name: 'Scenario 3: Kill During Partial Fill',
    type: 'PROCESS_KILL',
    timing: 'DURING_PARTIAL_FILL',
    description: 'Kill process during partial fill'
  },
  {
    name: 'Scenario 4: Kill During Margin Update',
    type: 'PROCESS_KILL',
    timing: 'DURING_MARGIN_UPDATE',
    description: 'Kill process during margin update'
  },
  {
    name: 'Scenario 5: Kill During Reconciliation',
    type: 'PROCESS_KILL',
    timing: 'DURING_RECONCILIATION',
    description: 'Kill process during reconciliation'
  },
  {
    name: 'Scenario 6: Kill During Event Replay',
    type: 'PROCESS_KILL',
    timing: 'DURING_REPLAY',
    description: 'Kill process during event replay'
  },
  
  // Network Chaos Scenarios
  {
    name: 'Scenario 7: Network Drop During Order Placement',
    type: 'NETWORK_DROP',
    duration: 5000,
    description: 'Simulate network drop while placing order'
  },
  {
    name: 'Scenario 8: Network Drop During Position Close',
    type: 'NETWORK_DROP',
    duration: 5000,
    description: 'Simulate network drop while closing position'
  },
  {
    name: 'Scenario 9: Slow Network Responses',
    type: 'SLOW_NETWORK',
    duration: 10000,
    description: 'Simulate 5-10 second network delays'
  },
  
  // Database Chaos Scenarios
  {
    name: 'Scenario 10: Database Connection Drop',
    type: 'DATABASE_DISCONNECT',
    duration: 5000,
    description: 'Simulate database connection loss'
  },
  {
    name: 'Scenario 11: Database Deadlock',
    type: 'SLOW_DATABASE',
    duration: 3000,
    description: 'Force concurrent operations causing deadlock'
  },
  {
    name: 'Scenario 12: Slow Database Queries',
    type: 'SLOW_DATABASE',
    duration: 10000,
    description: 'Simulate slow query responses'
  }
];

async function runAllChaosScenarios() {
  logger.info('🎯 Starting Chaos Engineering Test Suite');
  logger.info(`📋 Total Scenarios: ${CHAOS_SCENARIOS.length}`);
  logger.info('');

  const engineer = new ChaosEngineerService();
  const results: any[] = [];
  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < CHAOS_SCENARIOS.length; i++) {
    const scenario = CHAOS_SCENARIOS[i];
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`📍 Running ${i + 1}/${CHAOS_SCENARIOS.length}: ${scenario.name}`);
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');

    try {
      const result = await engineer.runScenario(scenario);
      results.push(result);

      if (result.success) {
        passedCount++;
        logger.info(`✅ PASSED: ${scenario.name}`);
      } else {
        failedCount++;
        logger.error(`❌ FAILED: ${scenario.name}`);
        logger.error(`   Issues: ${result.issues.length}`);
        result.issues.forEach(issue => {
          logger.error(`   - [${issue.severity}] ${issue.description}`);
        });
      }

      logger.info('');
      
      // Wait between scenarios
      if (i < CHAOS_SCENARIOS.length - 1) {
        logger.info('⏳ Waiting 10 seconds before next scenario...');
        await sleep(10000);
        logger.info('');
      }

    } catch (error) {
      failedCount++;
      logger.error(`💥 EXCEPTION in ${scenario.name}:`, error);
      results.push({
        scenario: scenario.name,
        success: false,
        error: (error as Error).message
      });
      logger.info('');
    }
  }

  // Generate final report
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('📊 CHAOS ENGINEERING TEST REPORT');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');
  logger.info(`📈 RESULTS SUMMARY:`);
  logger.info(`   Total Scenarios: ${CHAOS_SCENARIOS.length}`);
  logger.info(`   ✅ Passed: ${passedCount}`);
  logger.info(`   ❌ Failed: ${failedCount}`);
  logger.info(`   Success Rate: ${((passedCount / CHAOS_SCENARIOS.length) * 100).toFixed(1)}%`);
  logger.info('');

  if (failedCount === 0) {
    logger.info('🎉 ALL CHAOS SCENARIOS PASSED!');
    logger.info('');
    logger.info('✅ Success Criteria Met:');
    logger.info('   ✅ System recovered from all 12 scenarios');
    logger.info('   ✅ Zero data corruption detected');
    logger.info('   ✅ Zero duplicate events created');
    logger.info('   ✅ Perfect ledger after each recovery');
    logger.info('');
    logger.info('📋 NEXT STEPS:');
    logger.info('   1. Review detailed scenario reports');
    logger.info('   2. Proceed to Week 3: Manual Ledger Audit');
  } else {
    logger.error('❌ CHAOS ENGINEERING TEST FAILED');
    logger.error('');
    logger.error(`🚫 ${failedCount} scenario(s) failed:`);
    
    results.filter(r => !r.success).forEach((result, i) => {
      logger.error(`   ${i + 1}. ${result.scenario}`);
      if (result.issues) {
        result.issues.forEach((issue: any) => {
          logger.error(`      - ${issue.description}`);
        });
      }
    });
    
    logger.error('');
    logger.error('📋 REQUIRED ACTIONS:');
    logger.error('   1. Investigate root cause of each failure');
    logger.error('   2. Fix identified issues');
    logger.error('   3. Add tests to prevent recurrence');
    logger.error('   4. RERUN all chaos scenarios');
    logger.error('   5. RESTART from Week 1 (72-hour test)');
  }

  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════');

  // Save detailed report
  const reportPath = path.join(process.cwd(), 'reports', `chaos-test-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    executedAt: new Date(),
    totalScenarios: CHAOS_SCENARIOS.length,
    passed: passedCount,
    failed: failedCount,
    successRate: (passedCount / CHAOS_SCENARIOS.length) * 100,
    results
  }, null, 2));
  
  logger.info(`📄 Full report saved to: ${reportPath}`);

  // Exit with appropriate code
  process.exit(failedCount === 0 ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run all scenarios
runAllChaosScenarios();
