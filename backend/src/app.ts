import Fastify, { type FastifyInstance } from 'fastify';
import { getLogger, logRequest, logError } from './config/logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerStrategyRoutes } from './routes/strategy.js';
import { getEnvironmentConfig } from './config/env.js';

export async function createApp(): Promise<FastifyInstance> {
  const env = getEnvironmentConfig();
  const logger = getLogger();

  const app = Fastify({
    logger: false, // We handle logging ourselves
    disableRequestLogging: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID(),
  });

  // Request logging middleware
  app.addHook('onRequest', async request => {
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const responseTime = Date.now() - (request.startTime || Date.now());
    logRequest(
      request.method,
      request.url,
      reply.statusCode,
      responseTime,
      request.id
    );
  });

  // Error handling
  app.setErrorHandler(async (error, request, reply) => {
    logError(error, {
      requestId: request.id,
      method: request.method,
      url: request.url,
    });

    const statusCode = error.statusCode || 500;
    const message =
      env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;

    await reply.code(statusCode).send({
      error: {
        message,
        statusCode,
        requestId: request.id,
      },
    });
  });

  // Global error handlers for unhandled errors
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(
      {
        event: 'unhandled_rejection',
        reason,
        promise,
      },
      'Unhandled promise rejection'
    );
  });

  process.on('uncaughtException', error => {
    logger.fatal(
      {
        event: 'uncaught_exception',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      'Uncaught exception'
    );
    process.exit(1);
  });

  // Register routes
  await registerHealthRoutes(app);
  await registerStrategyRoutes(app);

  return app;
}

// Extend FastifyRequest interface to include startTime
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}
