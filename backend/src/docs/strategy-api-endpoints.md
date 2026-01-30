# Strategy API Endpoints

This document describes the REST API endpoints and WebSocket streaming capabilities implemented for the Strategy Engine.

## Base URL
All endpoints are prefixed with `/api/strategy`

## Authentication
Currently, no authentication is required for these endpoints.

## REST Endpoints

### Engine Status
- **GET** `/api/strategy/status`
- **Description**: Get current strategy engine status
- **Response**: Engine status, active runs count, and run details

### Candle Processing
- **POST** `/api/strategy/process`
- **Description**: Process a single candle through the strategy engine
- **Body**: `{ candle: Candle, indicators: IndicatorData }`
- **Response**: Strategy decision with full reasoning
- **Note**: Broadcasts decision to WebSocket clients

### Historical Runs
- **POST** `/api/strategy/run/historical`
- **Description**: Run strategy on historical data
- **Body**: `{ candles: Candle[], options?: RunOptions }`
- **Response**: Run result with statistics

### Strategy Decisions
- **GET** `/api/strategy/decisions`
- **Description**: Get strategy decisions with filtering
- **Query Parameters**:
  - `pair` (default: XAU/USD)
  - `timeframe` (default: 15M)
  - `decision` (BUY/SELL/NO_TRADE)
  - `startTime`, `endTime` (ISO date strings)
  - `limit` (default: 50)
  - `minConfidence` (0-1)

- **GET** `/api/strategy/decisions/:id`
- **Description**: Get specific decision with audit trail
- **Response**: Decision details, audit trail, and associated signal

### Trade Signals
- **GET** `/api/strategy/signals`
- **Description**: Get trade signals with filtering
- **Query Parameters**:
  - `direction` (BUY/SELL)
  - `startTime`, `endTime` (ISO date strings)
  - `minRR` (minimum reward-to-risk ratio)
  - `limit` (default: 50)

### Strategy Runs
- **GET** `/api/strategy/runs`
- **Description**: Get strategy runs with filtering
- **Query Parameters**:
  - `pair`, `timeframe`
  - `runType` (HISTORICAL/INCREMENTAL)
  - `limit` (default: 50)

- **GET** `/api/strategy/runs/:id`
- **Description**: Get specific run details with progress
- **Response**: Run details and current progress if active

- **POST** `/api/strategy/runs/:id/abort`
- **Description**: Abort an active strategy run
- **Response**: Success confirmation

### Performance Statistics
- **GET** `/api/strategy/statistics`
- **Description**: Get comprehensive performance statistics
- **Query Parameters**:
  - `pair` (default: XAU/USD)
  - `timeframe` (default: 15M)
  - `days` (default: 30)
  - `startTime`, `endTime` (ISO date strings)
- **Response**: Decision stats, signal stats, run stats, audit stats

### Configuration Management
- **GET** `/api/strategy/config`
- **Description**: Get current strategy configuration
- **Response**: Complete strategy configuration

- **PUT** `/api/strategy/config`
- **Description**: Update strategy configuration
- **Body**: `{ config: StrategyConfig }`
- **Response**: Updated configuration

### Audit Trail
- **GET** `/api/strategy/audit/:decisionId`
- **Description**: Get detailed audit trail for a specific decision
- **Response**: Complete audit trail with stage-by-stage results

### Health Check
- **GET** `/api/strategy/health`
- **Description**: Health check endpoint for strategy engine
- **Response**: Engine health status and metrics
- **Status Codes**: 200 (healthy), 503 (unhealthy)

### Data Cleanup
- **POST** `/api/strategy/cleanup`
- **Description**: Cleanup old strategy data
- **Body**: `{ days?: number }` (default: 90)
- **Response**: Cleanup statistics

## WebSocket Streaming

### Real-time Decision Stream
- **WebSocket** `/api/strategy/stream`
- **Description**: Real-time streaming of strategy decisions
- **Protocol**: JSON messages
- **Features**:
  - Automatic connection confirmation
  - Subscription management
  - Real-time decision broadcasting
  - Error handling and reconnection support

#### WebSocket Message Types

**Connection Confirmation**:
```json
{
  "type": "connected",
  "message": "Connected to strategy decision stream",
  "timestamp": "2024-01-11T10:30:00.000Z"
}
```

**Subscription Request**:
```json
{
  "type": "subscribe"
}
```

**Subscription Confirmation**:
```json
{
  "type": "subscribed",
  "message": "Successfully subscribed to strategy decisions",
  "timestamp": "2024-01-11T10:30:00.000Z"
}
```

**Real-time Decision**:
```json
{
  "type": "decision",
  "data": {
    "id": "uuid",
    "decision": "BUY",
    "pair": "XAU/USD",
    "confidenceScore": 0.85,
    "signal": { ... }
  },
  "timestamp": "2024-01-11T10:30:00.000Z"
}
```

**Error Message**:
```json
{
  "type": "error",
  "message": "Invalid message format",
  "timestamp": "2024-01-11T10:30:00.000Z"
}
```

## Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "error": "Error message",
  "requestId": "uuid"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error
- `503` - Service Unavailable (health check failure)

## Data Models

### StrategyDecision
```typescript
interface StrategyDecision {
  id: string;
  candleId: string;
  pair: string;
  timeframe: string;
  decision: 'BUY' | 'SELL' | 'NO_TRADE';
  regime: MarketRegime;
  setupType?: SetupType;
  confidenceScore: number;
  reason: DecisionReason;
  tradingWindowStart: string;
  tradingWindowEnd: string;
  candleTimestamp: Date;
  signal?: TradeSignal;
}
```

### TradeSignal
```typescript
interface TradeSignal {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskPercent: number;
  leverage: number;
  positionSize: number;
  marginRequired: number;
}
```

## Implementation Notes

- All endpoints use Fastify framework for high performance
- WebSocket support provided by `@fastify/websocket` plugin
- Real-time broadcasting to all connected WebSocket clients
- Comprehensive error handling and logging
- Type-safe request/response handling with TypeScript
- Database operations through repository pattern
- Configurable parameters with validation

## Requirements Validation

This implementation satisfies the following requirements:

- **6.1**: Complete auditability through decision storage and audit endpoints
- **9.1**: Strategy decisions persisted with complete metadata
- **9.2**: Trade signals stored with all parameters
- **9.3**: Audit logs maintained for all decision stages
- **9.4**: Strategy runs tracked with metadata and progress

The API provides comprehensive access to all strategy engine functionality with real-time streaming capabilities for live decision monitoring.