/**
 * Discipline Schema Migration Script
 *
 * Applies the discipline guardian database schema to Supabase.
 * This creates the tables, indexes, views, and functions needed
 * for tracking human interventions and calculating opportunity cost.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔧 DISCIPLINE SCHEMA MIGRATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  try {
    // Read the SQL schema file
    const schemaPath = join(
      __dirname,
      '../src/discipline/database/discipline-schema.sql'
    );
    const schema = readFileSync(schemaPath, 'utf-8');

    console.log('📄 Loaded discipline schema');
    console.log('');

    // Split into individual statements
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    console.log(`📊 Found ${statements.length} SQL statements`);
    console.log('');

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');

      console.log(`[${i + 1}/${statements.length}] ${preview}...`);

      const { error } = await supabase.rpc('exec_sql', {
        sql: statement + ';',
      });

      if (error) {
        // Try direct execution if RPC fails
        const { error: directError } = await supabase.from('_').select(statement);

        if (directError) {
          console.error(`❌ Failed: ${directError.message}`);
          throw directError;
        }
      }

      console.log(`   ✅ Success`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Created:');
    console.log('  - discipline_interventions table');
    console.log('  - shadow_positions table');
    console.log('  - discipline_metrics view');
    console.log('  - calculate_discipline_streak() function');
    console.log('  - update_intervention_opportunity_cost() function');
    console.log('  - trigger_update_opportunity_cost trigger');
    console.log('');
    console.log('The Discipline Guardian is ready.');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ MIGRATION FAILED');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('');
    console.error(error);
    console.error('');
    process.exit(1);
  }
}

runMigration();
