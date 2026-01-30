import { getEnvironmentConfig } from '../config/env.js';
import {
  BrokerConfiguration,
  OandaConfig,
  FxcmConfig,
} from './broker.interface.js';

/**
 * Broker Configuration Management
 *
 * Handles loading and validation of broker configurations from environment variables.
 * Ensures that broker settings are properly configured before attempting connections.
 */

export class BrokerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerConfigurationError';
  }
}

export function getOandaConfig(): OandaConfig {
  const env = getEnvironmentConfig();

  if (!env.OANDA_API_URL || !env.OANDA_API_KEY || !env.OANDA_ACCOUNT_ID) {
    throw new BrokerConfigurationError(
      'OANDA configuration incomplete. Required: OANDA_API_URL, OANDA_API_KEY, OANDA_ACCOUNT_ID'
    );
  }

  return {
    type: 'oanda',
    name: 'OANDA',
    enabled: true,
    rateLimitPerMinute: 120, // OANDA's typical rate limit
    apiUrl: env.OANDA_API_URL,
    apiKey: env.OANDA_API_KEY,
    accountId: env.OANDA_ACCOUNT_ID,
  };
}

export function getFxcmConfig(): FxcmConfig {
  const env = getEnvironmentConfig();

  if (!env.FXCM_API_URL || !env.FXCM_ACCESS_TOKEN) {
    throw new BrokerConfigurationError(
      'FXCM configuration incomplete. Required: FXCM_API_URL, FXCM_ACCESS_TOKEN'
    );
  }

  return {
    type: 'fxcm',
    name: 'FXCM',
    enabled: true,
    rateLimitPerMinute: 100, // FXCM's typical rate limit
    apiUrl: env.FXCM_API_URL,
    accessToken: env.FXCM_ACCESS_TOKEN,
  };
}

export function getActiveBrokerConfig(): BrokerConfiguration {
  const env = getEnvironmentConfig();

  if (!env.ACTIVE_BROKER) {
    throw new BrokerConfigurationError(
      'No active broker configured. Set ACTIVE_BROKER to either "oanda" or "fxcm"'
    );
  }

  switch (env.ACTIVE_BROKER) {
    case 'oanda':
      return getOandaConfig();
    case 'fxcm':
      return getFxcmConfig();
    default:
      throw new BrokerConfigurationError(
        `Unknown broker type: ${env.ACTIVE_BROKER}. Must be "oanda" or "fxcm"`
      );
  }
}

export function validateBrokerConfig(config: BrokerConfiguration): void {
  if (!config.name || !config.type) {
    throw new BrokerConfigurationError(
      'Broker configuration must have name and type'
    );
  }

  if (config.rateLimitPerMinute <= 0) {
    throw new BrokerConfigurationError('Rate limit must be positive');
  }

  switch (config.type) {
    case 'oanda':
      const oandaConfig = config as OandaConfig;
      if (
        !oandaConfig.apiUrl ||
        !oandaConfig.apiKey ||
        !oandaConfig.accountId
      ) {
        throw new BrokerConfigurationError(
          'OANDA configuration must include apiUrl, apiKey, and accountId'
        );
      }
      break;

    case 'fxcm':
      const fxcmConfig = config as FxcmConfig;
      if (!fxcmConfig.apiUrl || !fxcmConfig.accessToken) {
        throw new BrokerConfigurationError(
          'FXCM configuration must include apiUrl and accessToken'
        );
      }
      break;

    default:
      throw new BrokerConfigurationError(
        `Unsupported broker type: ${config.type}`
      );
  }
}

export function getAllAvailableBrokerConfigs(): BrokerConfiguration[] {
  const configs: BrokerConfiguration[] = [];
  const env = getEnvironmentConfig();

  // Try to load OANDA config if available
  if (env.OANDA_API_URL && env.OANDA_API_KEY && env.OANDA_ACCOUNT_ID) {
    try {
      configs.push(getOandaConfig());
    } catch (error) {
      // Ignore configuration errors for optional brokers
    }
  }

  // Try to load FXCM config if available
  if (env.FXCM_API_URL && env.FXCM_ACCESS_TOKEN) {
    try {
      configs.push(getFxcmConfig());
    } catch (error) {
      // Ignore configuration errors for optional brokers
    }
  }

  return configs;
}
