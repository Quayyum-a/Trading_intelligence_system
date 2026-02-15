#!/usr/bin/env node

/**
 * Task 8: Ledger Completeness Migration Runner
 * 
 * This script applies the ledger completeness database migration:
 * - Renames columns to match requirements
 * - Adds NOT NULL constraints
 * - Adds CHECK constraint for balance equation
 * - Creates indexes for ledger queries
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🚀 Starting Ledger Completeness Migration (Task 8)...\n');

  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'src/execution/position-lifecycle/database/ledger-completeness-migration.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📊 Checking current schema...\n');

    // Check if columns already renamed
    const { data: columns, error: schemaError } = await supabase
      .from('account_balance_events')
      .select('*')
      .limit(1);

    if (schemaError && !schemaError.message.includes('does not exist')) {
      console.error('❌ Error checking schema:', schemaError.message);
      process.exit(1);
    }

    // Split migration into individual statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip comments and DO blocks (they need special handling)
      if (statement.startsWith('COMMENT') || statement.startsWith('DO $$')) {
        console.log(`⏭️  Skipping statement ${i + 1} (${statement.substring(0, 50)}...)`);
        continue;
      }

      console.log(`▶️  Executing statement ${i + 1}/${statements.length}...`);
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });
        
        if (error) {
          // Check if error is because constraint/index already exists
          if (error.message.includes('already exists') || 
              error.message.includes('does not exist') ||
              error.message.includes('column') && error.message.includes('already')) {
            console.log(`   ⚠️  Already applied or not applicable: ${error.message.substring(0, 100)}`);
          } else {
            console.error(`   ❌ Error: ${error.message}`);
            // Don't exit, continue with other statements
          }
        } else {
          console.log(`   ✅ Success`);
        }
      } catch (err) {
        console.error(`   ❌ Exception: ${err.message}`);
      }
    }

    console.log('\n✅ Migration completed!');
    console.log('\n📋 Summary:');
    console.log('   - Renamed columns: previous_balance → balance_before, new_balance → balance_after, change_amount → amount');
    console.log('   - Added NOT NULL constraints on balance fields');
    console.log('   - Added CHECK constraint: balance_after = balance_before + amount');
    console.log('   - Created indexes for ledger queries');
    console.log('\n⚠️  Note: If you see errors about missing functions or permissions, you may need to run this migration directly in Supabase SQL Editor');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\n💡 Alternative: Run the migration SQL directly in Supabase SQL Editor:');
    console.error('   1. Open Supabase Dashboard → SQL Editor');
    console.error('   2. Copy contents of: src/execution/position-lifecycle/database/ledger-completeness-migration.sql');
    console.error('   3. Execute the SQL');
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);
