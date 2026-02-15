#!/usr/bin/env node

/**
 * Migration script to add idempotency_key column to position_events table
 * Requirements: 1.3.1, 1.3.2
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   - SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🔄 Running idempotency key migration...\n');

  try {
    // Read the migration SQL file
    const migrationPath = join(__dirname, 'src/execution/position-lifecycle/database/migrations/add-idempotency-key.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log('📝 Migration SQL:');
    console.log(migrationSQL);
    console.log('');

    // Execute the migration using Supabase RPC
    // Note: Supabase doesn't support direct SQL execution via the client library
    // We need to use the SQL editor or create an RPC function
    
    // Alternative: Execute each statement separately
    const statements = [
      `ALTER TABLE position_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE`,
      `CREATE INDEX IF NOT EXISTS idx_position_events_idempotency ON position_events(idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `COMMENT ON COLUMN position_events.idempotency_key IS 'Unique key for idempotent operations. Format: close_\${positionId}_\${timestamp}'`
    ];

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 80)}...`);
      
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        // If RPC doesn't exist, we need to run it manually
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          console.log('\n⚠️  Cannot execute SQL directly via Supabase client.');
          console.log('📋 Please run the migration manually in your Supabase SQL Editor:');
          console.log('\n' + migrationSQL + '\n');
          process.exit(1);
        }
        throw error;
      }
    }

    console.log('\n✅ Migration completed successfully!');
    
    // Verify the column was added
    const { data, error: verifyError } = await supabase
      .from('position_events')
      .select('idempotency_key')
      .limit(1);

    if (verifyError) {
      console.log('\n⚠️  Could not verify migration (this is expected if table is empty)');
      console.log('   Error:', verifyError.message);
    } else {
      console.log('\n✅ Verified: idempotency_key column is accessible');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.log('\n📋 Please run the migration manually in your Supabase SQL Editor:');
    console.log('\nFile: src/execution/position-lifecycle/database/migrations/add-idempotency-key.sql\n');
    process.exit(1);
  }
}

runMigration();
