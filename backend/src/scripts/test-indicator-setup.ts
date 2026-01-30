#!/usr/bin/env tsx

import { setupIndicatorTables, verifyIndicatorTables } from '../database/setup-indicators.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

async function testIndicatorSetup(): Promise<void> {
  try {
    console.log('🧪 Testing Indicator Engine Setup...\n');

    // Test database table setup
    console.log('📊 Setting up indicator database tables...');
    await setupIndicatorTables();
    console.log('✅ Database tables setup completed\n');

    // Verify tables exist
    console.log('🔍 Verifying indicator tables...');
    const isValid = await verifyIndicatorTables();
    
    if (isValid) {
      console.log('✅ All indicator tables verified successfully\n');
    } else {
      console.log('❌ Table verification failed\n');
      process.exit(1);
    }

    console.log('🎉 Indicator Engine setup test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   ✅ EMA values table ready');
    console.log('   ✅ ATR values table ready');
    console.log('   ✅ Swing points table ready');
    console.log('   ✅ All indexes and constraints in place');
    console.log('\n🚀 The Indicator Engine is ready for use!');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Indicator setup test failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    console.error('❌ Indicator setup test failed:', errorMessage);
    process.exit(1);
  }
}

// Run the test
testIndicatorSetup();