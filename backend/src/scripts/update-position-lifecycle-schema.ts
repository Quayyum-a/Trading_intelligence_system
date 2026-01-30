#!/usr/bin/env tsx

/**
 * Update Position Lifecycle Schema
 * Adds missing columns to the positions table for position lifecycle engine
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateSchema() {
  console.log('🔧 Updating position lifecycle schema...');

  try {
    // Check if execution_trade_id column exists
    console.log('Checking if execution_trade_id column exists...');
    const { data: existingColumns, error: checkError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'positions')
      .eq('column_name', 'execution_trade_id');

    if (checkError) {
      console.error('Error checking column existence:', checkError);
      return;
    }

    if (existingColumns && existingColumns.length > 0) {
      console.log('✅ execution_trade_id column already exists');
    } else {
      console.log('❌ execution_trade_id column does not exist');
      console.log('This column needs to be added manually to the database');
      console.log('Please run this SQL command in your Supabase SQL editor:');
      console.log('ALTER TABLE positions ADD COLUMN IF NOT EXISTS execution_trade_id UUID;');
    }

    // Test if we can query the positions table
    console.log('Testing positions table access...');
    const { data: testData, error: testError } = await supabase
      .from('positions')
      .select('id')
      .limit(1);

    if (testError) {
      console.error('Error accessing positions table:', testError);
    } else {
      console.log('✅ Positions table accessible');
    }

    console.log('✅ Schema check completed');

  } catch (error) {
    console.error('❌ Schema check failed:', error);
    process.exit(1);
  }
}

// Run the update
updateSchema().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});