/**
 * Migration script to create reconciliation_log table
 * Run this script to add the reconciliation_log table to your Supabase database
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Starting reconciliation_log table migration...\n');

  try {
    // Read the SQL schema file
    const schemaPath = path.join(
      __dirname,
      'src/execution/position-lifecycle/database/reconciliation-log-schema.sql'
    );
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing SQL schema...');

    // Split SQL into individual statements
    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    // Execute each statement
    for (const statement of statements) {
      if (statement.includes('CREATE EXTENSION')) {
        console.log('Skipping CREATE EXTENSION (already exists)');
        continue;
      }

      try {
        // For CREATE TABLE and CREATE INDEX, we can use Supabase's query method
        if (statement.includes('CREATE TABLE') || statement.includes('CREATE INDEX')) {
          const { error } = await supabase.rpc('exec_sql', { sql: statement });
          if (error) {
            // If RPC doesn't exist, try direct execution (may not work for all statements)
            console.warn(`RPC exec_sql not available, attempting direct execution...`);
            // Note: Direct execution of DDL may not be supported by Supabase client
            console.log(`Statement: ${statement.substring(0, 100)}...`);
          } else {
            console.log(`✓ Executed: ${statement.substring(0, 60)}...`);
          }
        } else if (statement.includes('COMMENT ON')) {
          console.log(`Skipping COMMENT statement (optional)`);
        }
      } catch (err) {
        console.error(`Error executing statement: ${err.message}`);
        console.log(`Statement: ${statement.substring(0, 100)}...`);
      }
    }

    // Verify table was created
    console.log('\nVerifying reconciliation_log table...');
    const { data, error } = await supabase
      .from('reconciliation_log')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Table verification failed:', error.message);
      console.log('\nPlease run the SQL schema manually in Supabase SQL Editor:');
      console.log(schemaPath);
    } else {
      console.log('✓ Table verified successfully!');
      console.log('\n✅ Migration completed successfully!');
      console.log('\nThe reconciliation_log table is now ready to use.');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('\nPlease run the SQL schema manually in Supabase SQL Editor:');
    console.log(
      'src/execution/position-lifecycle/database/reconciliation-log-schema.sql'
    );
    process.exit(1);
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\nMigration script completed.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
