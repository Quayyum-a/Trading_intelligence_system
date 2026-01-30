# Position Lifecycle Engine Test Suite

This directory contains comprehensive tests for the Position Lifecycle Engine, validating the complete position lifecycle from creation to closure, cross-service communication, and system integrity.

## Test Structure

### 🧪 Test Files

1. **`position-lifecycle-engine.integration.test.ts`**
   - End-to-end integration tests
   - Complete position lifecycle scenarios (PENDING → OPEN → CLOSED)
   - Cross-service communication validation
   - Database transaction integrity
   - Performance and scalability testing

2. **`position-lifecycle-properties.test.ts`**
   - Property-based testing using fast-check
   - Validates all 45 correctness properties from the design document
   - Tests universal properties across random inputs
   - Minimum 100 iterations per property as specified

3. **`system-validation.test.ts`**
   - Comprehensive system validation
   - Cross-service communication testing
   - Event sourcing and state consistency
   - System integrity and error handling
   - Performance benchmarking

4. **`setup.ts`**
   - Test utilities and generators
   - Property-based test arbitraries
   - Helper functions for test data creation
   - Performance measurement utilities

5. **`run-tests.ts`**
   - Test runner script
   - Executes all test suites with reporting
   - Performance analysis and summary generation

## Test Coverage

### 🔄 Position Lifecycle Scenarios

- **Position Creation**: PENDING state initialization
- **Entry Fills**: Transition to OPEN state with proper execution tracking
- **Partial Fills**: Size adjustments while maintaining OPEN state
- **PnL Updates**: Real-time unrealized PnL calculations
- **Stop Loss/Take Profit**: Automated closure triggers
- **Forced Liquidation**: Margin breach handling
- **Position Archival**: Final state transitions

### 🔗 Cross-Service Communication

- **Position State Machine** ↔ **Event Service**: State transition logging
- **Execution Tracking** ↔ **PnL Calculation**: Fill processing and PnL updates
- **Risk Ledger** ↔ **Account Balance**: Margin management
- **SL/TP Monitor** ↔ **Liquidation Engine**: Risk management triggers
- **Paper Trading** ↔ **System Integrity**: Simulation consistency

### 📊 Data Consistency Validation

- **Referential Integrity**: Foreign key relationships across tables
- **Event Ordering**: Chronological event sequences
- **State Consistency**: Position state matches execution history
- **Balance Reconciliation**: Account balance equals sum of position PnL
- **Audit Trail Completeness**: All changes recorded in events

### 🛡️ System Integrity Checks

- **Deterministic Processing**: Identical inputs produce identical outputs
- **Idempotent Operations**: Duplicate events handled correctly
- **Event Replay**: System state reconstruction from events
- **Error Recovery**: Graceful handling of service failures
- **Performance Thresholds**: Operations complete within time limits

## Property-Based Testing

The test suite validates 45 correctness properties defined in the design document:

### State Machine Properties (1-7)
- Position initialization consistency
- First fill state transitions
- Partial exit handling
- Take profit/stop loss closures
- Liquidation triggers
- Position archival

### Execution Tracking Properties (8-14)
- Execution recording completeness
- Entry/exit fill classification
- Execution type validation
- Price and size accuracy

### PnL Calculation Properties (15-17)
- Unrealized PnL formula correctness
- Realized PnL accumulation
- Commission inclusion

### Event Sourcing Properties (18-22)
- Event creation for state changes
- Event record completeness
- Replay consistency
- Idempotent processing
- State validation after replay

### Risk Management Properties (23-40)
- SL/TP trigger detection
- Margin reservation/release
- Leverage enforcement
- Liquidation initiation
- Balance event logging

### System Integrity Properties (41-45)
- Deterministic processing
- Crash recovery
- Simulation consistency
- State machine rule enforcement
- Balance reconciliation

## Running the Tests

### Prerequisites

1. **Environment Setup**:
   ```bash
   # Set environment variables
   export SUPABASE_URL="your-supabase-url"
   export SUPABASE_ANON_KEY="your-supabase-key"
   ```

2. **Database Setup**:
   - Ensure Supabase database is running
   - Position lifecycle tables are created
   - Test account has sufficient permissions

### Test Execution

#### Run All Tests
```bash
# Using the test runner
npm run test:position-lifecycle

# Or directly with vitest
npx vitest src/execution/position-lifecycle/tests/
```

#### Run Specific Test Suite
```bash
# Integration tests only
npm run test:position-lifecycle -- --suite integration

# Property-based tests only
npm run test:position-lifecycle -- --suite properties

# System validation tests only
npm run test:position-lifecycle -- --suite validation
```

#### Run Individual Test Files
```bash
# Integration tests
npx vitest src/execution/position-lifecycle/tests/position-lifecycle-engine.integration.test.ts

# Property-based tests
npx vitest src/execution/position-lifecycle/tests/position-lifecycle-properties.test.ts

# System validation
npx vitest src/execution/position-lifecycle/tests/system-validation.test.ts
```

### Test Configuration

#### Vitest Configuration
```typescript
// vitest.config.ts
export default {
  test: {
    timeout: 30000,        // 30 second timeout
    testTimeout: 30000,    // Individual test timeout
    hookTimeout: 10000,    // Setup/teardown timeout
    teardownTimeout: 10000,
    setupFiles: ['src/execution/position-lifecycle/tests/setup.ts']
  }
}
```

#### Property Test Configuration
```typescript
const PROPERTY_TEST_CONFIG = {
  numRuns: 100,    // Minimum iterations per property
  timeout: 10000,  // 10 second timeout per property
  verbose: false,  // Set to true for detailed output
  seed: 42        // For reproducible tests
};
```

## Performance Thresholds

The test suite enforces performance requirements:

| Operation | Threshold | Description |
|-----------|-----------|-------------|
| Position Creation | 1000ms | Create new position with PENDING state |
| Execution Processing | 500ms | Process fills and update position |
| PnL Calculation | 100ms | Update unrealized PnL |
| State Transition | 200ms | Change position state |
| Event Recording | 150ms | Create position event |
| Integrity Check | 2000ms | Full system integrity validation |

## Test Data Management

### Automatic Cleanup
- All test data is automatically cleaned up after each test
- Position IDs are tracked and removed from database
- Account balances are reset to initial state
- No test data persists between test runs

### Test Isolation
- Each test creates its own positions and data
- Tests do not interfere with each other
- Database transactions ensure consistency
- Concurrent test execution is safe

## Debugging Tests

### Verbose Output
```bash
# Enable detailed test output
npx vitest --reporter=verbose src/execution/position-lifecycle/tests/

# Enable property test details
# Set verbose: true in PROPERTY_TEST_CONFIG
```

### Database Inspection
```bash
# Check test data during debugging
# (Remember to disable cleanup temporarily)
```

### Performance Profiling
```bash
# Run with performance monitoring
npm run test:position-lifecycle -- --reporter=verbose
```

## Expected Test Results

### Successful Test Run Output
```
🧪 POSITION LIFECYCLE ENGINE - COMPREHENSIVE TEST EXECUTION
================================================================================

🔍 Checking prerequisites...
✅ Prerequisites check completed

🏃 Running Integration Tests...
   End-to-end position lifecycle scenarios and cross-service communication
   Timeout: 30s

✅ Integration Tests PASSED (15234ms)

🏃 Running Property-Based Tests...
   Property-based testing for all correctness properties
   Timeout: 60s

✅ Property-Based Tests PASSED (45678ms)

🏃 Running System Validation Tests...
   Comprehensive system validation and performance testing
   Timeout: 45s

✅ System Validation Tests PASSED (23456ms)

📊 TEST EXECUTION SUMMARY
================================================================================

Total Test Suites: 3
Passed: 3
Failed: 0
Total Duration: 84.37s

📋 DETAILED RESULTS:

✅ PASSED Integration Tests (15.23s)
✅ PASSED Property-Based Tests (45.68s)
✅ PASSED System Validation Tests (23.46s)

⚡ PERFORMANCE ANALYSIS:

Average test suite duration: 28.12s
Slowest test suite: Property-Based Tests (45.68s)
Fastest test suite: Integration Tests (15.23s)
✅ All test suites completed within performance thresholds

🎉 ALL TESTS PASSED - POSITION LIFECYCLE ENGINE IS READY FOR PRODUCTION

✅ End-to-end position lifecycle scenarios validated
✅ All correctness properties verified
✅ System integrity and performance confirmed
✅ Cross-service communication tested
✅ Error handling and recovery validated

🚀 The Position Lifecycle Engine has passed comprehensive testing
   and is ready for production deployment.
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify SUPABASE_URL and SUPABASE_ANON_KEY
   - Check database is running and accessible
   - Ensure test account has proper permissions

2. **Test Timeouts**
   - Increase timeout values in vitest.config.ts
   - Check database performance
   - Verify no blocking operations

3. **Property Test Failures**
   - Check generator constraints in setup.ts
   - Verify property logic in design document
   - Review failing examples for patterns

4. **Performance Issues**
   - Monitor database query performance
   - Check for resource leaks
   - Verify cleanup is working properly

### Getting Help

- Review the Position Lifecycle Engine design document
- Check the requirements document for acceptance criteria
- Examine the implementation in `position-lifecycle-engine.ts`
- Look at existing test patterns in other test files

## Contributing

When adding new tests:

1. Follow the existing test structure and naming conventions
2. Add appropriate cleanup in `afterEach` hooks
3. Use the test utilities from `setup.ts`
4. Update performance thresholds if needed
5. Document any new test scenarios in this README

## Test Maintenance

- Review and update tests when requirements change
- Monitor test performance and adjust thresholds
- Keep test data generators up to date
- Ensure test coverage remains comprehensive
- Update documentation when adding new test scenarios