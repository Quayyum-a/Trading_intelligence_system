# Indicator Engine

A deterministic, auditable system that derives market intelligence from stored candle data. The system computes technical indicators (EMA, ATR, Market Structure) and persists them to the database for analysis.

## Features

### ✅ Implemented Core Functionality

- **Pure Indicator Functions**: EMA, ATR, and Swing Detection calculations
- **Database Schema**: Tables for EMA values, ATR values, and swing points
- **Repository Layer**: Type-safe data access with upsert behavior
- **Indicator Runner Service**: Orchestrates calculations and persistence
- **Error Handling**: Comprehensive validation and error recovery
- **Testing**: Unit tests for all indicator functions

### 🎯 Key Architectural Principles

- **Deterministic**: Same inputs always produce identical outputs
- **Pure Functions**: Indicator calculations have no side effects
- **Incremental Processing**: Efficient updates for new data
- **Timestamp Alignment**: All indicators align exactly with candle timestamps

## Quick Start

### 1. Setup Database Tables

```bash
npm run indicators:setup
```

### 2. Verify Setup

```bash
npm run indicators:verify
```

### 3. Test the System

```bash
npm run indicators:test
```

### 4. Run Tests

```bash
npm test -- src/indicators/
```

## Usage

### Basic Indicator Calculations

```typescript
import { calculateEMA } from './indicators/ema.indicator.js';
import { calculateATR } from './indicators/atr.indicator.js';
import { detectSwings } from './indicators/swing.indicator.js';

// Calculate EMA for 20 periods
const emaResults = calculateEMA(candles, 20);

// Calculate ATR for 14 periods
const atrResults = calculateATR(candles, 14);

// Detect swing points with 5-period lookback
const swingPoints = detectSwings(candles, 5);
```

### Using the Indicator Runner Service

```typescript
import { IndicatorRunnerService } from './services/indicator-runner.service.js';

const service = new IndicatorRunnerService();

// Run historical build for all indicators
await service.runHistoricalBuild('EURUSD', '1h');

// Run incremental update for new data
await service.runIncrementalUpdate('EURUSD', '1h');

// Validate indicator accuracy
const validation = await service.validateIndicators('EURUSD', '1h');
```

## Supported Indicators

### EMA (Exponential Moving Average)
- **Periods**: 20, 50, 200
- **Source**: Close prices
- **Formula**: EMA = (Close × α) + (Previous EMA × (1 - α))
- **Where**: α = 2 / (period + 1)

### ATR (Average True Range)
- **Period**: 14
- **Formula**: ATR = SMA of True Range over 14 periods
- **True Range**: MAX(High - Low, |High - Previous Close|, |Low - Previous Close|)

### Swing Detection
- **Configurable lookback periods** (default: 5)
- **Swing High**: High > all highs within N periods left and right
- **Swing Low**: Low < all lows within N periods left and right
- **No repainting**: Uses fixed lookback window

## Database Schema

### EMA Values Table
```sql
CREATE TABLE ema_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  period INTEGER NOT NULL,
  value DECIMAL(20,8) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pair, timeframe, timestamp, period)
);
```

### ATR Values Table
```sql
CREATE TABLE atr_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  period INTEGER NOT NULL,
  value DECIMAL(20,8) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pair, timeframe, timestamp, period)
);
```

### Swing Points Table
```sql
CREATE TABLE swing_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('high', 'low')),
  price DECIMAL(20,8) NOT NULL,
  lookback_periods INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pair, timeframe, timestamp, type, lookback_periods)
);
```

## File Structure

```
src/indicators/
├── indicator.interface.ts     # Core interfaces and types
├── ema.indicator.ts          # EMA calculation functions
├── atr.indicator.ts          # ATR calculation functions
├── swing.indicator.ts        # Swing detection functions
├── error-handling.ts         # Validation and error utilities
├── test-setup.ts            # Property-based test generators
├── indicators.test.ts       # Unit tests
├── indicator-runner.test.ts # Service tests
└── README.md               # This file

src/repositories/
├── ema.repository.ts        # EMA data access
├── atr.repository.ts        # ATR data access
└── swing.repository.ts      # Swing points data access

src/services/
└── indicator-runner.service.ts  # Main orchestration service

src/database/
├── indicator-schema.sql     # Database schema
└── setup-indicators.ts     # Database setup utilities
```

## Testing

The system includes comprehensive testing:

- **Unit Tests**: Test individual indicator functions
- **Integration Tests**: Test service orchestration
- **Property-Based Testing**: Ready for fast-check integration
- **Error Handling Tests**: Validate error scenarios

Run all indicator tests:
```bash
npm test -- src/indicators/
```

## Error Handling

The system includes robust error handling at multiple levels:

- **Input Validation**: OHLC relationships, positive values, data types
- **Calculation Errors**: Division by zero, overflow conditions
- **Database Errors**: Connection failures, constraint violations
- **Service Errors**: Partial failures, validation errors

## Performance Considerations

- **Incremental Updates**: Only processes new candles since last run
- **Batch Operations**: Efficient database insertions with upserts
- **Memory Management**: Processes data in manageable chunks
- **Indexing**: Optimized database indexes for fast queries

## Next Steps

The core Indicator Engine is now ready for use. Optional enhancements include:

- Property-based testing implementation
- Additional indicator types (RSI, MACD, Bollinger Bands)
- Real-time streaming updates
- Performance monitoring and metrics
- Advanced validation and alerting