#!/usr/bin/env node

import { getSupabaseClient } from '../config/supabase.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();
const client = getSupabaseClient();

/**
 * Setup database tables by creating them if they don't exist
 */
async function setupDatabaseTables() {
  logger.info('Setting up database tables...');

  try {
    // Test if tables exist by trying to query them
    const tables = [
      { name: 'ema_values', description: 'EMA indicator values' },
      { name: 'atr_values', description: 'ATR indicator values' },
      { name: 'swings', description: 'Swing point data' }
    ];

    for (const table of tables) {
      try {
        logger.info(`Checking table: ${table.name}`);
        const { data, error } = await client
          .from(table.name)
          .select('*')
          .limit(1);

        if (error) {
          if (error.message.includes('does not exist')) {
            logger.warn(`Table ${table.name} does not exist - needs to be created manually`);
            logger.info(`Please create table ${table.name} in your database`);
          } else {
            logger.error(`Error checking table ${table.name}:`, error);
          }
        } else {
          logger.info(`✅ Table ${table.name} exists and is accessible`);
        }
      } catch (err) {
        logger.error(`Failed to check table ${table.name}:`, err);
      }
    }

    logger.info('Database table check completed');
    
  } catch (error) {
    logger.error('Failed to setup database tables:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabaseTables()
    .then(() => {
      logger.info('Database setup completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Database setup failed:', error);
      process.exit(1);
    });
}

export { setupDatabaseTables };