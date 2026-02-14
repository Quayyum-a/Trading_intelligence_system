import { getSupabaseClient } from './src/config/supabase.js';

async function testConnection() {
  console.log('🔍 Testing Supabase connection...');
  
  try {
    const client = getSupabaseClient();
    console.log('✅ Supabase client created successfully');
    
    // Test a simple query to check if tables exist
    const { data, error } = await client.from('candles').select('count').limit(1);
    
    if (error) {
      console.log('❌ Database query failed:', error.message);
      console.log('Error details:', error);
    } else {
      console.log('✅ Database connection and query successful!');
      console.log('Query result:', data);
    }
  } catch (err) {
    console.log('❌ Connection failed:', err.message);
    console.log('Full error:', err);
  }
}

testConnection();