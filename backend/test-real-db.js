import { createClient } from '@supabase/supabase-js';

async function testRealDatabase() {
  console.log('🔍 Testing REAL Supabase connection...');
  
  const supabaseUrl = 'https://ztxdyafzbkzpkwtthirs.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0eGR5YWZ6Ymt6cGt3dHRoaXJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAxNzUwNCwiZXhwIjoyMDgzNTkzNTA0fQ.Fe5-XZpXcm9czPZ8w4tojceTHJqc5TOyM4IONNe0DJY';
  
  try {
    // Create direct Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    
    console.log('✅ Supabase client created successfully');
    
    // Test basic connectivity
    console.log('🔍 Testing basic connectivity...');
    const { data, error } = await supabase.from('candles').select('count').limit(1);
    
    if (error) {
      console.log('❌ Database query failed:', error.message);
      console.log('Error code:', error.code);
      console.log('Error details:', error.details);
      
      // Check if it's a table not found error
      if (error.code === '42P01') {
        console.log('📋 Table "candles" does not exist. Need to run database setup.');
        return false;
      }
      
      return false;
    } else {
      console.log('✅ Database connection successful!');
      console.log('Query result:', data);
      return true;
    }
  } catch (err) {
    console.log('❌ Connection failed:', err.message);
    console.log('Full error:', err);
    return false;
  }
}

// Run the test
testRealDatabase().then(success => {
  if (success) {
    console.log('🎉 Database is ready for tests!');
  } else {
    console.log('⚠️  Database needs setup before running tests.');
  }
});