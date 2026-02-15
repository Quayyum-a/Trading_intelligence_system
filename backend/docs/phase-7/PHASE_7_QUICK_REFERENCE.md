# Phase 7: War Testing - Quick Reference

**Status:** ✅ Ready to Execute  
**Duration:** 7 weeks minimum

---

## Commands

```bash
# Run all tests (Weeks 1-3)
npm run test:phase-7

# Run individual weeks
npm run test:72-hour      # Week 1: 72 hours
npm run test:chaos        # Week 2: 1-2 hours
npm run test:audit        # Week 3: 1-2 hours
npm run test:live-capital # Week 4+: 30 days
```

---

## The 3 Gates

### Gate 1: 72-Hour Run ✅ or ❌
- Zero critical errors
- Perfect ledger balance
- 100% SL/TP execution

### Gate 2: Chaos Engineering ✅ or ❌
- All 12 scenarios pass
- Zero data corruption
- Perfect recovery

### Gate 3: Manual Audit ✅ or ❌
- Perfect balance equation
- 100% event coverage
- Zero discrepancies

---

## Timeline

| Week | Test | Duration | Command |
|------|------|----------|---------|
| 1 | 72-Hour Run | 3 days | `npm run test:72-hour` |
| 2 | Chaos Engineering | 1-2 hours | `npm run test:chaos` |
| 3 | Manual Audit | 1-2 hours | `npm run test:audit` |
| 4+ | Live Capital | 30 days | `npm run test:live-capital` |

---

## Success Criteria

**Week 1:**
- ✅ Zero critical errors for 72 hours
- ✅ Perfect ledger balance maintained
- ✅ All integrity checks pass

**Week 2:**
- ✅ All 12 chaos scenarios pass
- ✅ Zero data corruption detected
- ✅ Perfect recovery every time

**Week 3:**
- ✅ Perfect balance equation (to the cent)
- ✅ 100% event coverage
- ✅ Zero discrepancies found

**Week 4+:**
- ✅ Zero critical errors for 30 days
- ✅ Perfect ledger balance
- ✅ No manual intervention needed

---

## Failure Protocol

**If ANY test fails:**

1. STOP immediately
2. INVESTIGATE root cause
3. FIX the issue
4. ADD prevention test
5. RESTART from Week 1

**No shortcuts. No exceptions.**

---

## Alert Levels

🔴 **Critical** - Immediate action required  
🟠 **High** - Action within 1 hour  
🟡 **Medium** - Action within 4 hours

---

## Reports Location

```
reports/
├── 72-hour-test-{timestamp}.json
├── chaos-test-{timestamp}.json
├── manual-audit-{timestamp}.json
└── live-capital-{timestamp}.json
```

---

## Key Files

**Services:**
- `src/war-testing/services/continuous-monitor.service.ts`
- `src/war-testing/services/chaos-engineer.service.ts`
- `src/war-testing/services/manual-auditor.service.ts`
- `src/war-testing/services/live-capital-monitor.service.ts`

**Scripts:**
- `src/war-testing/scripts/run-72-hour-test.ts`
- `src/war-testing/scripts/run-chaos-scenarios.ts`
- `src/war-testing/scripts/run-manual-audit.ts`
- `src/war-testing/scripts/run-live-capital-test.ts`

**Documentation:**
- `PHASE_7_COMPLETION_REPORT.md` - Full report
- `PHASE_7_IMPLEMENTATION_SUMMARY.md` - Implementation details
- `src/war-testing/README.md` - Technical guide
- `.kiro/specs/phase-7-war-testing/` - Spec files

---

## Before You Start

- [ ] Database connection verified
- [ ] OANDA credentials verified
- [ ] Monitoring dashboards ready
- [ ] Alert notifications configured
- [ ] Team briefed on protocol

---

## Next Steps After Success

1. Complete independent code review
2. Obtain stakeholder approval
3. Deploy $100-$500 live capital
4. Monitor for 30 days
5. Scale gradually: $1K → $5K → $10K

---

## Remember

**Architecture doesn't protect capital.**  
**Discipline does.**

This is not about passing tests.  
This is about proving the system can survive reality.

---

**Ready to start?**

```bash
npm run test:phase-7
```

