import { createApp } from './app.js';
import { getEnvironmentConfig } from './config/env.js';
import { logStartup, logShutdown, getLogger } from './config/logger.js';
import {
  getSupabaseClient,
  testSupabaseConnection,
} from './config/supabase.js';

async function startServer(): Promise<void> {
  try {
    // Load and validate environment configuration
    const env = getEnvironmentConfig();
    const logger = getLogger();

    logger.info('Starting server initialization');

    // Initialize and test Supabase connection
    logger.info('Initializing database connection');
    try {
      getSupabaseClient(); // Initialize the client
      const connectionTest = await testSupabaseConnection();

      if (!connectionTest) {
        throw new Error('Database connection test failed');
      }

      logger.info('Database connection established successfully');
    } catch (error) {
      logger.error('Database initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(
        `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Create the Fastify application
    const app = await createApp();

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, `Received ${signal}, starting graceful shutdown`);
      logShutdown(signal);

      try {
        // Close Fastify server first
        await app.close();
        logger.info('Server closed successfully');

        // Note: Supabase client doesn't require explicit cleanup as it uses HTTP connections
        logger.info('Database connections cleaned up');

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during graceful shutdown');
        process.exit(1);
      }
    };

    // Register signal handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Start the server
    const address = await app.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });

    logStartup(env.PORT, env.NODE_ENV);
    logger.info({ address }, 'Server listening');
  } catch (error) {
    const logger = getLogger();
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  const logger = getLogger();
  logger.fatal({ error }, 'Unhandled error during server startup');
  process.exit(1);
});
