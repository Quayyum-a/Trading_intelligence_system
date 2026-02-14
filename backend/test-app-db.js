import { getSupabaseClient } from './src/config/supabase.js';

async function testAppDatabase() {
  console.log('🔍 Testing application Supabase client...');
  
  try {
    const client = getSupabaseClient();
    console.log('✅ Client created successfully');
    
    const { data, error } = await client.from('candles').select('count').limit(1);
    if (error) {
      console.log('❌ Query failed:', error.message);
      return false;
    } else {
      console.log('✅ Query successful:', data);
      return true;
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return false;
  }
}

testAppDatabase();