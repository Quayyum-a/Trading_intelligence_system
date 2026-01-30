import pino from 'pino';
import { getEnvironmentConfig } from './env.js';

export interface LogContext {
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  responseTime?: number;
  [key: string]: unknown;
}

let logger: pino.Logger | null = null;

export function createLogger(): pino.Logger {
  if (logger) {
    return logger;
  }

  const env = getEnvironmentConfig();

  const loggerConfig: pino.LoggerOptions = {
    level: env.LOG_LEVEL,
    base: {
      pid: process.pid,
      hostname: process.env['HOSTNAME'] || 'unknown',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };

  // Add pretty printing for development
  if (env.NODE_ENV === 'development') {
    loggerConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  logger = pino(loggerConfig);
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    return createLogger();
  }
  return logger;
}

export function logStartup(port: number, environment: string): void {
  const logger = getLogger();
  logger.info(
    {
      event: 'server_startup',
      port,
      environment,
      nodeVersion: process.version,
      platform: process.platform,
    },
    'Server starting up'
  );
}

export function logShutdown(signal?: string): void {
  const logger = getLogger();
  logger.info(
    {
      event: 'server_shutdown',
      signal,
    },
    'Server shutting down'
  );
}

export function logError(error: Error, context?: LogContext): void {
  const logger = getLogger();
  logger.error(
    {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    },
    'Error occurred'
  );
}

export function logRequest(
  method: string,
  url: string,
  statusCode: number,
  responseTime: number,
  requestId?: string
): void {
  const logger = getLogger();
  logger.info(
    {
      event: 'http_request',
      method,
      url,
      statusCode,
      responseTime,
      requestId,
    },
    `${method} ${url} ${statusCode} - ${responseTime}ms`
  );
}
// Export logger for direct use
export { logger };
