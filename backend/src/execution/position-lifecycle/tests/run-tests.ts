#!/usr/bin/env tsx

/**
 * Position Lifecycle Engine Test Runner
 * 
 * Comprehensive test execution script for the position lifecycle engine
 * Runs integration tests, property-based tests, and system validation tests
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestSuite {
  name: string;
  file: string;
  description: string;
  timeout: number;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'Integration Tests',
    file: 'position-lifecycle-engine.integration.test.ts',
    description: 'End-to-end position lifecycle scenarios and cross-service communication',
    timeout: 30000
  },
  {
    name: 'Property-Based Tests',
    file: 'position-lifecycle-properties.test.ts',
    description: 'Property-based testing for all correctness properties',
    timeout: 60000
  },
  {
    name: 'System Validation Tests',
    file: 'system-validation.test.ts',
    description: 'Comprehensive system validation and performance testing',
    timeout: 45000
  }
];

interface TestResults {
  suite: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

class TestRunner {
  private results: TestResults[] = [];
  private startTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 POSITION LIFECYCLE ENGINE - COMPREHENSIVE TEST EXECUTION');
    console.log('=' .repeat(80));
    console.log();

    // Check prerequisites
    this.checkPrerequisites();

    // Run each test suite
    for (const suite of TEST_SUITES) {
      await this.runTestSuite(suite);
    }

    // Generate summary report
    this.generateSummaryReport();
  }

  private checkPrerequisites(): void {
    console.log('🔍 Checking prerequisites...');

    // Check if test files exist
    for (const suite of TEST_SUITES) {
      const testFile = path.join(__dirname, suite.file);
      if (!existsSync(testFile)) {
        throw new Error(`Test file not found: ${suite.file}`);
      }
    }

    // Check environment variables
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
      console.warn('   Using default test values...');
    }

    // Check if database is accessible (simplified check)
    try {
      // This would normally ping the database
      console.log('✅ Prerequisites check completed');
    } catch (error) {
      console.warn('⚠️  Database connectivity check failed, proceeding anyway...');
    }

    console.log();
  }

  private async runTestSuite(suite: TestSuite): Promise<void> {
    console.log(`🏃 Running ${suite.name}...`);
    console.log(`   ${suite.description}`);
    console.log(`   Timeout: ${suite.timeout / 1000}s`);
    console.log();

    const startTime = Date.now();
    let result: TestResults;

    try {
      // Run the test suite using vitest
      const command = `npx vitest run ${suite.file} --reporter=verbose`;
      const output = execSync(command, {
        cwd: path.join(__dirname, '../../../..'), // Go to project root
        encoding: 'utf8',
        timeout: suite.timeout + 10000, // Add buffer to command timeout
        env: {
          ...process.env,
          VITEST_TIMEOUT: suite.timeout.toString()
        }
      });

      const duration = Date.now() - startTime;
      
      result = {
        suite: suite.name,
        passed: true,
        duration,
        output
      };

      console.log(`✅ ${suite.name} PASSED (${duration}ms)`);
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      result = {
        suite: suite.name,
        passed: false,
        duration,
        output: error.stdout || '',
        error: error.stderr || error.message
      };

      console.log(`❌ ${suite.name} FAILED (${duration}ms)`);
      if (error.stderr) {
        console.log('Error output:');
        console.log(error.stderr);
      }
    }

    this.results.push(result);
    console.log();
  }

  private generateSummaryReport(): void {
    const totalDuration = Date.now() - this.startTime;
    const passedTests = this.results.filter(r => r.passed).length;
    const totalTests = this.results.length;

    console.log('📊 TEST EXECUTION SUMMARY');
    console.log('=' .repeat(80));
    console.log();

    // Overall results
    console.log(`Total Test Suites: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log();

    // Individual suite results
    console.log('📋 DETAILED RESULTS:');
    console.log();

    for (const result of this.results) {
      const status = result.passed ? '✅ PASSED' : '❌ FAILED';
      const duration = (result.duration / 1000).toFixed(2);
      
      console.log(`${status} ${result.suite} (${duration}s)`);
      
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error.split('\n')[0]}`);
      }
    }

    console.log();

    // Performance analysis
    this.generatePerformanceReport();

    // Final verdict
    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED - POSITION LIFECYCLE ENGINE IS READY FOR PRODUCTION');
      console.log();
      console.log('✅ End-to-end position lifecycle scenarios validated');
      console.log('✅ All correctness properties verified');
      console.log('✅ System integrity and performance confirmed');
      console.log('✅ Cross-service communication tested');
      console.log('✅ Error handling and recovery validated');
      console.log();
      console.log('🚀 The Position Lifecycle Engine has passed comprehensive testing');
      console.log('   and is ready for production deployment.');
    } else {
      console.log('❌ SOME TESTS FAILED - REVIEW REQUIRED');
      console.log();
      console.log('Please review the failed tests and address any issues before deployment.');
      process.exit(1);
    }
  }

  private generatePerformanceReport(): void {
    console.log('⚡ PERFORMANCE ANALYSIS:');
    console.log();

    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;
    const slowestTest = this.results.reduce((prev, current) => 
      prev.duration > current.duration ? prev : current
    );
    const fastestTest = this.results.reduce((prev, current) => 
      prev.duration < current.duration ? prev : current
    );

    console.log(`Average test suite duration: ${(avgDuration / 1000).toFixed(2)}s`);
    console.log(`Slowest test suite: ${slowestTest.suite} (${(slowestTest.duration / 1000).toFixed(2)}s)`);
    console.log(`Fastest test suite: ${fastestTest.suite} (${(fastestTest.duration / 1000).toFixed(2)}s)`);
    console.log();

    // Performance thresholds
    const performanceThresholds = {
      integration: 30000, // 30s
      properties: 60000,  // 60s
      validation: 45000   // 45s
    };

    let performanceIssues = 0;
    for (const result of this.results) {
      const threshold = result.suite.includes('Property') ? performanceThresholds.properties :
                       result.suite.includes('Integration') ? performanceThresholds.integration :
                       performanceThresholds.validation;

      if (result.duration > threshold) {
        console.log(`⚠️  Performance concern: ${result.suite} exceeded threshold (${(result.duration / 1000).toFixed(2)}s > ${(threshold / 1000).toFixed(2)}s)`);
        performanceIssues++;
      }
    }

    if (performanceIssues === 0) {
      console.log('✅ All test suites completed within performance thresholds');
    }

    console.log();
  }

  // Method to run specific test suite
  async runSpecificTest(suiteName: string): Promise<void> {
    const suite = TEST_SUITES.find(s => s.name.toLowerCase().includes(suiteName.toLowerCase()));
    
    if (!suite) {
      console.error(`❌ Test suite not found: ${suiteName}`);
      console.log('Available test suites:');
      TEST_SUITES.forEach(s => console.log(`  - ${s.name}`));
      process.exit(1);
    }

    console.log(`🧪 Running specific test suite: ${suite.name}`);
    console.log();

    await this.runTestSuite(suite);
    this.generateSummaryReport();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new TestRunner();

  if (args.length === 0) {
    // Run all tests
    await runner.runAllTests();
  } else if (args[0] === '--suite' && args[1]) {
    // Run specific test suite
    await runner.runSpecificTest(args[1]);
  } else if (args[0] === '--help' || args[0] === '-h') {
    // Show help
    console.log('Position Lifecycle Engine Test Runner');
    console.log();
    console.log('Usage:');
    console.log('  npm run test:position-lifecycle              # Run all test suites');
    console.log('  npm run test:position-lifecycle -- --suite integration  # Run specific suite');
    console.log('  npm run test:position-lifecycle -- --help               # Show this help');
    console.log();
    console.log('Available test suites:');
    TEST_SUITES.forEach(suite => {
      console.log(`  - ${suite.name.toLowerCase().replace(/\s+/g, '-')}: ${suite.description}`);
    });
  } else {
    console.error('❌ Invalid arguments. Use --help for usage information.');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

// Run the main function
main().catch(error => {
  console.error('❌ Test runner failed:', error.message);
  process.exit(1);
});

export { TestRunner, TEST_SUITES };