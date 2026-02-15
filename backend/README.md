# Trading Intelligence System - Backend

A robust trading system backend with position lifecycle management, broker integration, and comprehensive risk controls.

## Project Structure

```
backend/
├── src/                    # Source code
│   ├── brokers/           # Broker integrations (OANDA, FXCM)
│   ├── execution/         # Position lifecycle & execution logic
│   ├── config/            # Configuration & environment
│   └── cli/               # CLI tools
├── scripts/               # Database migrations & setup scripts
├── docs/                  # Documentation
├── .kiro/                 # Kiro AI specs & workflows
└── tests/                 # Test suites (in src/)
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Run database setup:
   ```bash
   node scripts/setup-position-tables.js
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Key Features

- Multi-broker support (OANDA, FXCM, Paper Trading)
- Position lifecycle management with SL/TP
- Event sourcing & replay capabilities
- Transaction coordination & integrity checks
- Broker reconciliation
- Comprehensive test coverage

## Scripts

- `scripts/setup-position-tables.js` - Initialize database tables
- `scripts/run-ledger-migration.js` - Migrate ledger completeness
- `scripts/run-reconciliation-migration.js` - Setup reconciliation
- `scripts/run-idempotency-migration.js` - Setup idempotency controls

## Development

Built with TypeScript, Node.js, and Supabase.
