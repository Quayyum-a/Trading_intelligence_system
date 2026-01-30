#!/usr/bin/env tsx

import { CandleRepository } from '../repositories/candle.repository.js';
import type { Candle } from '../types/database.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

// Sample test candles with realistic trading data
const testCandles: Omit<Candle, 'id' | 'created_at'>[] = [
  // BTC/USD 1H candles
  {
    pair: 'BTC/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T10:00:00Z'),
    open: 42500.0,
    high: 42750.5,
    low: 42300.25,
    close: 42650.75,
    volume: 125.5,
  },
  {
    pair: 'BTC/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T11:00:00Z'),
    open: 42650.75,
    high: 42900.0,
    low: 42500.0,
    close: 42800.25,
    volume: 98.3,
  },
  {
    pair: 'BTC/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T12:00:00Z'),
    open: 42800.25,
    high: 43100.75,
    low: 42750.0,
    close: 43050.5,
    volume: 156.7,
  },

  // ETH/USD 1H candles
  {
    pair: 'ETH/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T10:00:00Z'),
    open: 2650.0,
    high: 2675.25,
    low: 2640.5,
    close: 2670.75,
    volume: 450.2,
  },
  {
    pair: 'ETH/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T11:00:00Z'),
    open: 2670.75,
    high: 2690.0,
    low: 2655.25,
    close: 2685.5,
    volume: 380.8,
  },

  // BTC/USD 15m candles
  {
    pair: 'BTC/USD',
    timeframe: '15m',
    timestamp: new Date('2024-01-10T10:00:00Z'),
    open: 42500.0,
    high: 42550.25,
    low: 42480.75,
    close: 42525.5,
    volume: 32.1,
  },
  {
    pair: 'BTC/USD',
    timeframe: '15m',
    timestamp: new Date('2024-01-10T10:15:00Z'),
    open: 42525.5,
    high: 42600.0,
    low: 42510.25,
    close: 42580.75,
    volume: 28.7,
  },
  {
    pair: 'BTC/USD',
    timeframe: '15m',
    timestamp: new Date('2024-01-10T10:30:00Z'),
    open: 42580.75,
    high: 42650.5,
    low: 42560.0,
    close: 42620.25,
    volume: 35.4,
  },

  // EUR/USD Forex pair
  {
    pair: 'EUR/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T10:00:00Z'),
    open: 1.095,
    high: 1.0965,
    low: 1.094,
    close: 1.0958,
    volume: 1250000,
  },
  {
    pair: 'EUR/USD',
    timeframe: '1h',
    timestamp: new Date('2024-01-10T11:00:00Z'),
    open: 1.0958,
    high: 1.0975,
    low: 1.0945,
    close: 1.0962,
    volume: 980000,
  },
];

async function insertTestCandles(): Promise<void> {
  try {
    logger.info('Starting test candle insertion');

    const candleRepository = new CandleRepository();
    let successCount = 0;
    let errorCount = 0;

    for (const candleData of testCandles) {
      try {
        await candleRepository.insertCandle(candleData);
        successCount++;
        logger.info(
          `✅ Inserted candle: ${candleData.pair} ${candleData.timeframe} ${candleData.timestamp.toISOString()}`
        );
      } catch (error) {
        errorCount++;
        if (
          error instanceof Error &&
          error.message.includes('Duplicate candle')
        ) {
          logger.warn(
            `⚠️  Skipped duplicate candle: ${candleData.pair} ${candleData.timeframe} ${candleData.timestamp.toISOString()}`
          );
        } else {
          logger.error(
            `❌ Failed to insert candle: ${candleData.pair} ${candleData.timeframe}`,
            {
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }
    }

    logger.info('Test candle insertion completed', {
      total: testCandles.length,
      successful: successCount,
      errors: errorCount,
    });

    // Test retrieval
    logger.info('Testing candle retrieval...');

    const btcCandles = await candleRepository.getCandlesByPairAndTimeframe(
      'BTC/USD',
      '1h',
      10
    );
    logger.info(`Retrieved ${btcCandles.length} BTC/USD 1h candles`);

    const ethCandles = await candleRepository.getCandlesByPairAndTimeframe(
      'ETH/USD',
      '1h',
      10
    );
    logger.info(`Retrieved ${ethCandles.length} ETH/USD 1h candles`);

    // Display some sample data
    if (btcCandles.length > 0) {
      const latestBtc = btcCandles[0];
      logger.info('Latest BTC/USD candle:', {
        timestamp: latestBtc.timestamp.toISOString(),
        open: latestBtc.open,
        high: latestBtc.high,
        low: latestBtc.low,
        close: latestBtc.close,
        volume: latestBtc.volume,
      });
    }
  } catch (error) {
    logger.error('Failed to insert test candles', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  insertTestCandles()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Script failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      process.exit(1);
    });
}

export { insertTestCandles };
