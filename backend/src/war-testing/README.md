# Phase 7: War Testing

This directory contains all services and scripts for Phase 7 War Testing - the final validation before live capital deployment.

## Overview

Phase 7 validates that the system can survive real-world chaos through:
- **Week 1:** 72-hour continuous operation
- **Week 2:** 12 chaos engineering scenarios
- **Week 3:** Manual ledger audit
- **Week 4+:** 30-day live capital monitoring

## Directory Structure

```
war-testing/
├── services/
│   ├── continuous-monitor.service.ts    # Week 1: Continuous monitoring
│   ├── chaos-engineer.service.ts        # Week 2: Chaos engineering
│   ├── manual-auditor.service.ts        # Week 3: Manual audit
│   └── live-capital-monitor.service.ts  # Week 4+: Live capital
├── scripts/
│   ├── run-72-hour-test.ts             # Week 1 test runner
│   ├── run-chaos-scenarios.ts          # Week 2 test runner
│   ├── run-manual-audit.ts             # Week 3 test runner
│   └── run-live-capital-test.ts        # Week 4+ test runner
└── README.md                            # This file
```

## Quick Start

### Run All Tests (Weeks 1-3)
```bash
npm run test:phase-7
```

This will run:
1. 72-hour continuous run
2. All chaos scenarios (if Week 1 passes)
3. Manual ledger audit (if Week 2 passes)

### Run Individual Weeks

**Week 1: 72-Hour Continuous Run**
```bash
npm run test:72-hour
```
- Duration: 72 hours (5 minutes for testing)
- Validates: System stability, zero critical errors
- Pass Criteria: Zero critical errors, perfect ledger

**Week 2: Chaos Engineering**
```bash
npm run test:chaos
```
- Duration: 1-2 hours
- Validates: Recovery from 12 failure scenarios
- Pass Criteria: All scenarios pass, zero data corruption

**Week 3: Manual Ledger Audit**
```bash
npm run test:audit
```
- Duration: 1-2 hours
- Validates: Ledger accuracy, balance equation
- Pass Criteria: Perfect balance equation, zero discrepancies

**Week 4+: Live Capital (30 Days)**
```bash
npm run test:live-capital
```
- Duration: 30 days (10 minutes for testing)
- Validates: Real-world behavior with live capital
- Pass Criteria: Zero critical errors for 30 days

## Services

### ContinuousMonitorService

Monitors system health during 72-hour continuous run.

**Features:**
- Health checks every 1 minute (CPU, memory, database, broker)
- Position checks every 10 minutes (count, balance, margin)
- Integrity checks every 1 hour (balance equation, orphans)
- Real-time alerting

**Usage:**
```typescript
import { ContinuousMonitorService } from './services/continuous-monitor.service';

const monitor = new ContinuousMonitorService();
const report = await monitor.startMonitoring(72 * 60 * 60 * 1000); // 72 hours
```

### ChaosEngineerService

Injects failures and validates recovery.

**Features:**
- Process kill scenarios (6 scenarios)
- Network chaos scenarios (3 scenarios)
- Database chaos scenarios (3 scenarios)
- State capture and comparison
- Recovery validation

**Usage:**
```typescript
import { ChaosEngineerService } from './services/chaos-engineer.service';

const engineer = new ChaosEngineerService();
const result = await engineer.runScenario({
  name: 'Kill During Trade Open',
  type: 'PROCESS_KILL',
  timing: 'DURING_OPEN',
  description: 'Kill process while opening a position'
});
```

### ManualAuditorService

Performs comprehensive ledger audit.

**Features:**
- Data export (all tables)
- Balance equation verification
- Event coverage analysis
- PnL calculation verification
- Orphan detection

**Usage:**
```typescript
import { ManualAuditorService } from './services/manual-auditor.service';

const auditor = new ManualAuditorService();
const report = await auditor.performAudit();
```

### LiveCapitalMonitorService

Monitors live capital deployment.

**Features:**
- Daily health checks
- Weekly full audits
- Performance tracking
- Critical issue detection
- Automatic alerting

**Usage:**
```typescript
import { LiveCapitalMonitorService } from './services/live-capital-monitor.service';

const monitor = new LiveCapitalMonitorService();
const report = await monitor.monitorDeployment(30 * 24 * 60 * 60 * 1000); // 30 days
```

## Chaos Scenarios

### Process Kill Scenarios (6)
1. **Kill During Trade Open** - Validates position creation recovery
2. **Kill During Trade Close** - Validates position closure recovery
3. **Kill During Partial Fill** - Validates partial fill handling
4. **Kill During Margin Update** - Validates margin calculation recovery
5. **Kill During Reconciliation** - Validates reconciliation recovery
6. **Kill During Event Replay** - Validates replay recovery

### Network Chaos Scenarios (3)
7. **Network Drop During Order** - Validates order placement recovery
8. **Network Drop During Close** - Validates position close recovery
9. **Slow Network Responses** - Validates timeout handling

### Database Chaos Scenarios (3)
10. **Database Connection Drop** - Validates connection pool recovery
11. **Database Deadlock** - Validates deadlock handling
12. **Slow Database Queries** - Validates query timeout handling

## Success Criteria

### Gate 1: 72-Hour Run ✅ or ❌
- Zero critical errors
- 100% SL/TP execution
- Perfect ledger balance
- Zero reconciliation mismatches

### Gate 2: Chaos Engineering ✅ or ❌
- All 12 scenarios pass
- Zero data corruption
- Perfect recovery every time
- All integrity checks pass

### Gate 3: Manual Audit ✅ or ❌
- Perfect balance equation (to the cent)
- 100% event coverage
- Zero discrepancies
- All PnL calculations match

### Gate 4: Live Capital ✅ or ❌
- 30 days zero critical errors
- Perfect ledger balance
- All SL/TP executed correctly
- No manual intervention

## Failure Response

**If ANY test fails:**

1. **STOP** - Do not proceed to next week
2. **INVESTIGATE** - Find root cause
3. **FIX** - Implement solution
4. **TEST** - Add prevention test
5. **RESTART** - Go back to Week 1

**No shortcuts. Discipline protects capital.**

## Alert Levels

### 🔴 Critical (Immediate Action)
- Missed SL/TP trigger
- Balance equation violation
- Reconciliation mismatch
- Orphaned position
- System crash

### 🟠 High (Action Within 1 Hour)
- SL/TP latency >100ms
- Reconciliation latency >1s
- Event replay failure
- Database connection issues

### 🟡 Medium (Action Within 4 Hours)
- High resource usage (>80%)
- Slow queries
- Warning count increasing
- Performance degradation

## Reports

All tests generate detailed JSON reports in the `reports/` directory:

- `72-hour-test-{timestamp}.json` - Week 1 report
- `chaos-test-{timestamp}.json` - Week 2 report
- `manual-audit-{timestamp}.json` - Week 3 report
- `live-capital-{timestamp}.json` - Week 4+ report
- `phase-7-success-{timestamp}.json` - Success report
- `phase-7-failure-{timestamp}.json` - Failure report

## Configuration

### Testing vs Production

For testing, durations are shortened:
- 72-hour test → 5 minutes
- 30-day test → 10 minutes

To run actual production tests, update durations in:
- `run-72-hour-test.ts` - Change `duration` variable
- `run-live-capital-test.ts` - Change `duration` variable

### Environment Variables

Ensure these are set in `.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
OANDA_API_KEY=your_oanda_key
OANDA_ACCOUNT_ID=your_account_id
```

## Best Practices

1. **Run in Production-Like Environment**
   - Same infrastructure as production
   - Same database configuration
   - Same network conditions

2. **Monitor Continuously**
   - Review logs every 4 hours during 72-hour test
   - Check alerts immediately
   - Document any anomalies

3. **No Manual Intervention**
   - Let tests run without interference
   - Any manual fix = test failure
   - System must recover automatically

4. **Document Everything**
   - Save all reports
   - Document all issues
   - Track all fixes

5. **Follow Failure Protocol**
   - Never skip steps
   - Always restart from Week 1 after failure
   - Discipline over convenience

## Troubleshooting

### Test Won't Start
- Check database connection
- Check OANDA credentials
- Check TypeScript compilation
- Check dependencies installed

### Test Fails Immediately
- Review error logs
- Check database schema
- Check broker connection
- Verify environment variables

### Test Hangs
- Check for deadlocks
- Check network connectivity
- Check database connection pool
- Review process logs

## Next Steps After Phase 7

1. **If All Tests Pass:**
   - Complete independent code review
   - Obtain stakeholder approval
   - Deploy $100-$500 live capital
   - Monitor for 30 days
   - Scale gradually

2. **If Any Test Fails:**
   - Investigate root cause
   - Fix issues
   - Add prevention tests
   - Restart from Week 1

## Support

For issues or questions:
1. Review this README
2. Check Phase 7 documentation in `.kiro/specs/phase-7-war-testing/`
3. Review CTO Reality Check document
4. Review Phase 7 Completion Report

---

**Remember:** This is not about passing tests. This is about proving the system can protect capital in production.

**Discipline protects capital.**
