/**
 * Simple test to isolate the database connection issue
 */

import { describe, it, expect } from 'vitest';
import { PositionLifecycleEngine, PositionLifecycleEngineConfig } from '../position-lifecycle-engine';
import { createClient } from '@supabase/supabase-js';

describe('Simple Position Lifecycle Engine Test', () => {
  it('should initialize engine successfully', async () => {
    console.log('🧪 Running simple position lifecycle engine test...');
    console.log('Environment variables:');
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
    console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET');

    const config: PositionLifecycleEngineConfig = {
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      paperTradingConfig: {
        slippageEnabled: true,
        maxSlippageBps: 5,
        latencyMs: 50,
        rejectionRate: 0.01
      },
      maxLeverage: 200,
      marginCallLevel: 0.5,
      liquidationLevel: 0.2,
      commissionRate: 0.0001
    };

    console.log('Creating engine...');
    const engine = new PositionLifecycleEngine(config);

    console.log('Testing direct database connection...');
    const supabase = createClient(config.supabaseUrl, config.supabaseKey);
    
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'OPEN')
      .limit(1);
    
    if (error) {
      console.error('❌ Direct database query failed:', error);
      throw error;
    } else {
      console.log('✅ Direct database query successful, found', data.length, 'records');
    }

    console.log('Initializing engine...');
    try {
      console.log('Step 1: Initializing SL/TP monitoring...');
      await engine.initialize();
      console.log('✅ Engine initialized successfully');
      
      console.log('Step 2: Shutting down engine...');
      await engine.shutdown();
      console.log('✅ Engine shutdown successfully');
    } catch (error) {
      console.error('❌ Engine operation failed:', error);
      throw error;
    }

    expect(true).toBe(true); // Simple assertion to make the test pass
  }, 10000);
});