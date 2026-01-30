#!/usr/bin/env tsx

import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

async function createIndicatorTables(): Promise<void> {
  const client = getSupabaseClient();

  try {
    console.log('🔧 Creating indicator tables...\n');

    // SQL for creating EMA values table
    const emaTableSQL = `
      CREATE TABLE IF NOT EXISTS ema_values (
        id BIGSERIAL PRIMARY KEY,
        candle_id BIGINT,
        pair VARCHAR(20) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        period INTEGER NOT NULL,
        value DECIMAL(20, 8) NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ema_values_unique 
      ON ema_values (pair, timeframe, candle_timestamp, period);
      
      CREATE INDEX IF NOT EXISTS idx_ema_values_pair_timeframe 
      ON ema_values (pair, timeframe);
      
      CREATE INDEX IF NOT EXISTS idx_ema_values_timestamp 
      ON ema_values (candle_timestamp);
    `;

    // SQL for creating ATR values table
    const atrTableSQL = `
      CREATE TABLE IF NOT EXISTS atr_values (
        id BIGSERIAL PRIMARY KEY,
        candle_id BIGINT,
        pair VARCHAR(20) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        period INTEGER NOT NULL,
        value DECIMAL(20, 8) NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_atr_values_unique 
      ON atr_values (pair, timeframe, candle_timestamp, period);
      
      CREATE INDEX IF NOT EXISTS idx_atr_values_pair_timeframe 
      ON atr_values (pair, timeframe);
      
      CREATE INDEX IF NOT EXISTS idx_atr_values_timestamp 
      ON atr_values (candle_timestamp);
    `;

    // SQL for creating swing points table
    const swingsTableSQL = `
      CREATE TABLE IF NOT EXISTS swings (
        id BIGSERIAL PRIMARY KEY,
        candle_id BIGINT,
        pair VARCHAR(20) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        candle_timestamp TIMESTAMPTZ NOT NULL,
        swing_type VARCHAR(10) NOT NULL CHECK (swing_type IN ('HIGH', 'LOW')),
        price DECIMAL(20, 8) NOT NULL,
        left_lookback INTEGER NOT NULL,
        right_lookback INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_swings_unique 
      ON swings (pair, timeframe, candle_timestamp, swing_type, left_lookback);
      
      CREATE INDEX IF NOT EXISTS idx_swings_pair_timeframe 
      ON swings (pair, timeframe);
      
      CREATE INDEX IF NOT EXISTS idx_swings_timestamp 
      ON swings (candle_timestamp);
    `;

    // Create EMA table
    console.log('📊 Creating ema_values table...');
    const { error: emaError } = await client.rpc('exec_sql', { sql: emaTableSQL });
    if (emaError) {
      console.log('   ⚠️  Could not create EMA table via RPC, trying direct approach...');
      // Try to test if table exists
      const { error: testEmaError } = await client.from('ema_values').select('*').limit(1);
      if (testEmaError && testEmaError.message.includes('does not exist')) {
        console.log('   ❌ EMA table does not exist and cannot be created via API');
        console.log('   📋 Please run the SQL manually in your Supabase dashboard');
      } else {
        console.log('   ✅ EMA table accessible');
      }
    } else {
      console.log('   ✅ EMA table created successfully');
    }

    // Create ATR table
    console.log('📊 Creating atr_values table...');
    const { error: atrError } = await client.rpc('exec_sql', { sql: atrTableSQL });
    if (atrError) {
      console.log('   ⚠️  Could not create ATR table via RPC, trying direct approach...');
      const { error: testAtrError } = await client.from('atr_values').select('*').limit(1);
      if (testAtrError && testAtrError.message.includes('does not exist')) {
        console.log('   ❌ ATR table does not exist and cannot be created via API');
        console.log('   📋 Please run the SQL manually in your Supabase dashboard');
      } else {
        console.log('   ✅ ATR table accessible');
      }
    } else {
      console.log('   ✅ ATR table created successfully');
    }

    // Create swings table
    console.log('📊 Creating swings table...');
    const { error: swingError } = await client.rpc('exec_sql', { sql: swingsTableSQL });
    if (swingError) {
      console.log('   ⚠️  Could not create swings table via RPC, trying direct approach...');
      const { error: testSwingError } = await client.from('swings').select('*').limit(1);
      if (testSwingError && testSwingError.message.includes('does not exist')) {
        console.log('   ❌ Swings table does not exist and cannot be created via API');
        console.log('   📋 Please run the SQL manually in your Supabase dashboard');
      } else {
        console.log('   ✅ Swings table accessible');
      }
    } else {
      console.log('   ✅ Swings table created successfully');
    }

    console.log('\n🎉 Indicator table setup completed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. If tables could not be created automatically, run the SQL from database-schema-indicators.sql');
    console.log('   2. Run integration tests to verify the system works end-to-end');
    console.log('   3. Use: npm test -- src/integration/indicator-persistence.integration.test.ts');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to create indicator tables', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    console.error('❌ Table creation failed:', errorMessage);
    console.log('\n📋 Manual Setup Required:');
    console.log('   1. Open your Supabase dashboard');
    console.log('   2. Go to SQL Editor');
    console.log('   3. Run the SQL from database-schema-indicators.sql');
    process.exit(1);
  }
}

// Run the creation
createIndicatorTables();