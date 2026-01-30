import { config } from 'dotenv';

// Load environment variables once
config();

export interface EnvironmentConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Broker configuration
  OANDA_API_URL?: string;
  OANDA_API_KEY?: string;
  OANDA_ACCOUNT_ID?: string;
  FXCM_API_URL?: string;
  FXCM_ACCESS_TOKEN?: string;
  ACTIVE_BROKER?: 'oanda' | 'fxcm';
}

class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

function validateNodeEnv(
  value: string | undefined
): 'development' | 'production' | 'test' {
  if (!value) {
    throw new EnvironmentError('NODE_ENV is required');
  }

  if (!['development', 'production', 'test'].includes(value)) {
    throw new EnvironmentError(
      `NODE_ENV must be one of: development, production, test. Got: ${value}`
    );
  }

  return value as 'development' | 'production' | 'test';
}

function validatePort(value: string | undefined): number {
  if (!value) {
    throw new EnvironmentError('PORT is required');
  }

  const port = parseInt(value, 10);

  if (isNaN(port)) {
    throw new EnvironmentError(`PORT must be a valid number. Got: ${value}`);
  }

  if (port < 1 || port > 65535) {
    throw new EnvironmentError(
      `PORT must be between 1 and 65535. Got: ${port}`
    );
  }

  return port;
}

function validateLogLevel(
  value: string | undefined
): 'debug' | 'info' | 'warn' | 'error' {
  if (!value) {
    throw new EnvironmentError('LOG_LEVEL is required');
  }

  if (!['debug', 'info', 'warn', 'error'].includes(value)) {
    throw new EnvironmentError(
      `LOG_LEVEL must be one of: debug, info, warn, error. Got: ${value}`
    );
  }

  return value as 'debug' | 'info' | 'warn' | 'error';
}

function validateSupabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new EnvironmentError('SUPABASE_URL is required');
  }

  // Basic URL validation
  try {
    new URL(value);
  } catch {
    throw new EnvironmentError(
      `SUPABASE_URL must be a valid URL. Got: ${value}`
    );
  }

  return value;
}

function validateSupabaseKey(
  value: string | undefined,
  keyName: string
): string {
  if (!value) {
    throw new EnvironmentError(`${keyName} is required`);
  }

  if (value.length < 10) {
    throw new EnvironmentError(`${keyName} appears to be invalid (too short)`);
  }

  return value;
}

function validateActiveBroker(
  value: string | undefined
): 'oanda' | 'fxcm' | undefined {
  if (!value) {
    return undefined; // Optional field
  }

  if (!['oanda', 'fxcm'].includes(value)) {
    throw new EnvironmentError(
      `ACTIVE_BROKER must be one of: oanda, fxcm. Got: ${value}`
    );
  }

  return value as 'oanda' | 'fxcm';
}

function validateOptionalString(value: string | undefined): string | undefined {
  return value || undefined;
}

let environmentConfig: EnvironmentConfig | null = null;

export function getEnvironmentConfig(): EnvironmentConfig {
  if (environmentConfig) {
    return environmentConfig;
  }

  try {
    environmentConfig = {
      NODE_ENV: validateNodeEnv(process.env.NODE_ENV),
      PORT: validatePort(process.env.PORT),
      LOG_LEVEL: validateLogLevel(process.env.LOG_LEVEL),
      SUPABASE_URL: validateSupabaseUrl(process.env['SUPABASE_URL']),
      SUPABASE_ANON_KEY: validateSupabaseKey(
        process.env['SUPABASE_ANON_KEY'],
        'SUPABASE_ANON_KEY'
      ),
      SUPABASE_SERVICE_ROLE_KEY: validateSupabaseKey(
        process.env['SUPABASE_SERVICE_ROLE_KEY'],
        'SUPABASE_SERVICE_ROLE_KEY'
      ),
      // Broker configuration (optional)
      OANDA_API_URL: validateOptionalString(process.env['OANDA_API_URL']),
      OANDA_API_KEY: validateOptionalString(process.env['OANDA_API_KEY']),
      OANDA_ACCOUNT_ID: validateOptionalString(process.env['OANDA_ACCOUNT_ID']),
      FXCM_API_URL: validateOptionalString(process.env['FXCM_API_URL']),
      FXCM_ACCESS_TOKEN: validateOptionalString(
        process.env['FXCM_ACCESS_TOKEN']
      ),
      ACTIVE_BROKER: validateActiveBroker(process.env['ACTIVE_BROKER']),
    };

    return environmentConfig;
  } catch (error) {
    if (error instanceof EnvironmentError) {
      console.error(`Environment Configuration Error: ${error.message}`);
      console.error('Please check your environment variables and try again.');
      process.exit(1);
    }
    throw error;
  }
}

export { EnvironmentError };
