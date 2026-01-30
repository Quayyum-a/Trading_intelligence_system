// Global type definitions for the trading backend foundation

export interface EnvironmentConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
}

export interface HealthResponse {
  status: 'ok';
  environment: string;
  uptime: number;
}

export interface LogContext {
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  responseTime?: number;
  [key: string]: unknown;
}

export interface ErrorResponse {
  error: {
    message: string;
    statusCode: number;
    requestId?: string;
  };
}

export interface LogEvent {
  event: string;
  timestamp?: string;
  level?: string;
  [key: string]: unknown;
}

// Extend global namespace for Node.js process
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      PORT?: string;
      LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
    }
  }
}

// Fastify module augmentation for request timing
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

export {};
