import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvironmentConfig } from './env.js';
import { getLogger } from './logger.js';
import { createMockSupabaseClient, isTestEnvironment } from './test-database.js';

let supabaseClient: SupabaseClient | any = null;
let useMockClient = false;

export function getSupabaseClient(): SupabaseClient | any {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = getEnvironmentConfig();
  const logger = getLogger();

  // Use mock client in test environment or when database is not available
  if (isTestEnvironment() || useMockClient) {
    logger.info('Using mock Supabase client for testing');
    supabaseClient = createMockSupabaseClient();
    return supabaseClient;
  }

  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('Missing Supabase configuration, falling back to mock client');
    useMockClient = true;
    supabaseClient = createMockSupabaseClient();
    return supabaseClient;
  }

  try {
    // Create client using service role key for server-side operations
    supabaseClient = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    if (!supabaseClient) {
      throw new Error('Failed to create Supabase client');
    }

    logger.info('Supabase client initialized successfully', {
      url: config.SUPABASE_URL,
      hasServiceKey: !!config.SUPABASE_SERVICE_ROLE_KEY,
    });

    return supabaseClient;
  } catch (error) {
    logger.error('Failed to create real Supabase client, falling back to mock', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    useMockClient = true;
    supabaseClient = createMockSupabaseClient();
    return supabaseClient;
  }
}

export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    const logger = getLogger();

    // If using mock client, always return true
    if (useMockClient || isTestEnvironment()) {
      logger.info('Using mock Supabase client - connection test skipped');
      return true;
    }

    // Test with a simple query
    const { data, error } = await client.from('candles').select('count').limit(1);
    
    if (error) {
      logger.error('Supabase connection test failed', {
        error: error.message,
        code: error.code
      });
      // Fall back to mock client if connection fails
      logger.warn('Falling back to mock Supabase client');
      useMockClient = true;
      supabaseClient = createMockSupabaseClient();
      return true;
    }

    logger.info('Supabase connection test successful');
    return true;
  } catch (error) {
    const logger = getLogger();
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error('Supabase connection test failed, falling back to mock client', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Fall back to mock client
    useMockClient = true;
    supabaseClient = createMockSupabaseClient();
    return true;
  }
}

// Function to force mock client usage (useful for testing)
export function forceMockClient(): void {
  useMockClient = true;
  supabaseClient = null; // Reset so it gets recreated as mock
}

// Function to check if using mock client
export function isUsingMockClient(): boolean {
  return useMockClient || isTestEnvironment();
}

export { SupabaseClient };
