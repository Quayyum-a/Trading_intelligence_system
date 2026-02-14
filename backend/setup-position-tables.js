import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

async function setupPositionTables() {
  console.log('🔧 Setting up position lifecycle tables...');
  
  const supabaseUrl = 'https://ztxdyafzbkzpkwtthirs.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0eGR5YWZ6Ymt6cGt3dHRoaXJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAxNzUwNCwiZXhwIjoyMDgzNTkzNTA0fQ.Fe5-XZpXcm9czPZ8w4tojceTHJqc5TOyM4IONNe0DJY';
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    
    // Read the position lifecycle schema
    const schemaSQL = readFileSync('./src/execution/position-lifecycle/database/position-lifecycle-schema.sql', 'utf8');
    
    console.log('📋 Executing position lifecycle schema...');
    const { data, error } = await supabase.rpc('exec_sql', { sql: schemaSQL });
    
    if (error) {
      console.log('❌ Schema execution failed:', error.message);
      
      // Try executing individual statements
      console.log('🔄 Trying individual statements...');
      const statements = schemaSQL.split(';').filter(stmt => stmt.trim().length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim();
        if (stmt) {
          console.log(`Executing statement ${i + 1}/${statements.length}...`);
          const { error: stmtError } = await supabase.rpc('exec_sql', { sql: stmt });
          if (stmtError) {
            console.log(`⚠️  Statement ${i + 1} failed:`, stmtError.message);
          } else {
            console.log(`✅ Statement ${i + 1} executed successfully`);
          }
        }
      }
    } else {
      console.log('✅ Position lifecycle schema executed successfully!');
    }
    
    return true;
  } catch (err) {
    console.log('❌ Setup failed:', err.message);
    return false;
  }
}

setupPositionTables();