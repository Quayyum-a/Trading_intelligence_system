import { BrokerAdapter, BrokerConfiguration } from './broker.interface.js';
import { OandaBroker } from './oanda.broker.js';
import { FxcmBroker } from './fxcm.broker.js';
import {
  getActiveBrokerConfig,
  validateBrokerConfig,
} from './broker-config.js';
import { logger } from '../config/logger.js';

/**
 * Broker Factory
 *
 * Creates broker adapter instances based on configuration.
 * Provides a centralized way to instantiate brokers and ensures
 * proper configuration validation.
 */

export class BrokerFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerFactoryError';
  }
}

export class BrokerFactory {
  /**
   * Creates a broker adapter instance from configuration
   */
  static createBroker(config: BrokerConfiguration): BrokerAdapter {
    validateBrokerConfig(config);

    switch (config.type) {
      case 'oanda':
        logger.info('Creating OANDA broker adapter', {
          brokerName: config.name,
        });
        return new OandaBroker(config);

      case 'fxcm':
        logger.info('Creating FXCM broker adapter', {
          brokerName: config.name,
        });
        return new FxcmBroker(config);

      default:
        throw new BrokerFactoryError(
          `Unsupported broker type: ${(config as any).type}`
        );
    }
  }

  /**
   * Creates the active broker adapter based on environment configuration
   */
  static createActiveBroker(): BrokerAdapter {
    const config = getActiveBrokerConfig();
    return this.createBroker(config);
  }

  /**
   * Creates all available broker adapters based on environment configuration
   */
  static createAllAvailableBrokers(): BrokerAdapter[] {
    const { getAllAvailableBrokerConfigs } = require('./broker-config.js');
    const configs = getAllAvailableBrokerConfigs();

    return configs.map(config => this.createBroker(config));
  }

  /**
   * Validates that a broker adapter is properly configured and connected
   */
  static async validateBrokerConnection(
    broker: BrokerAdapter
  ): Promise<boolean> {
    try {
      logger.info('Validating broker connection', {
        brokerName: broker.getBrokerName(),
      });
      const isValid = await broker.validateConnection();

      if (isValid) {
        logger.info('Broker connection validated successfully', {
          brokerName: broker.getBrokerName(),
        });
      } else {
        logger.error('Broker connection validation failed', {
          brokerName: broker.getBrokerName(),
        });
      }

      return isValid;
    } catch (error) {
      logger.error('Error during broker connection validation', {
        brokerName: broker.getBrokerName(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}
