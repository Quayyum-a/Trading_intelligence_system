/**
 * Broker Factory - Creates broker adapter instances based on execution mode
 */

import { BrokerAdapter } from '../interfaces/broker-adapter.interface';
import { ExecutionMode, PaperTradingConfig } from '../types/execution.types';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { getLogger } from '../../config/logger';
const logger = getLogger();

export interface BrokerFactoryConfig {
  executionMode: ExecutionMode;
  paperTradingConfig?: PaperTradingConfig;
  // Future: MT5 and REST broker configs
}

export class BrokerFactory {
  /**
   * Create a broker adapter based on execution mode
   */
  static createBrokerAdapter(config: BrokerFactoryConfig): BrokerAdapter {
    logger.info('Creating broker adapter', {
      executionMode: config.executionMode
    });

    switch (config.executionMode) {
      case 'PAPER':
        return this.createPaperBrokerAdapter(config.paperTradingConfig);
      
      case 'MT5':
        throw new Error('MT5 broker adapter not yet implemented');
      
      case 'REST':
        throw new Error('REST broker adapter not yet implemented');
      
      default:
        throw new Error(`Unsupported execution mode: ${config.executionMode}`);
    }
  }

  /**
   * Create paper trading broker adapter
   */
  private static createPaperBrokerAdapter(config?: PaperTradingConfig): PaperBrokerAdapter {
    const defaultConfig: PaperTradingConfig = {
      slippageEnabled: true,
      maxSlippageBps: 2, // 0.2 pips
      spreadSimulation: true,
      latencyMs: 100,
      partialFillsEnabled: false,
      rejectionRate: 0.01, // 1% rejection rate
      fillRule: 'IMMEDIATE'
    };

    const finalConfig = { ...defaultConfig, ...config };
    
    logger.info('Creating paper broker adapter', {
      config: finalConfig
    });

    return new PaperBrokerAdapter(finalConfig);
  }

  /**
   * Validate broker factory configuration
   */
  static validateConfig(config: BrokerFactoryConfig): void {
    if (!config.executionMode) {
      throw new Error('Execution mode is required');
    }

    if (!['PAPER', 'MT5', 'REST'].includes(config.executionMode)) {
      throw new Error(`Invalid execution mode: ${config.executionMode}`);
    }

    if (config.executionMode === 'PAPER' && config.paperTradingConfig) {
      this.validatePaperTradingConfig(config.paperTradingConfig);
    }
  }

  /**
   * Validate paper trading configuration
   */
  private static validatePaperTradingConfig(config: PaperTradingConfig): void {
    if (config.maxSlippageBps < 0) {
      throw new Error('Max slippage BPS must be non-negative');
    }

    if (config.latencyMs < 0) {
      throw new Error('Latency must be non-negative');
    }

    if (config.rejectionRate < 0 || config.rejectionRate > 1) {
      throw new Error('Rejection rate must be between 0 and 1');
    }

    if (!['NEXT_CANDLE_OPEN', 'IMMEDIATE', 'REALISTIC_DELAY'].includes(config.fillRule)) {
      throw new Error(`Invalid fill rule: ${config.fillRule}`);
    }
  }

  /**
   * Get default configuration for an execution mode
   */
  static getDefaultConfig(executionMode: ExecutionMode): BrokerFactoryConfig {
    switch (executionMode) {
      case 'PAPER':
        return {
          executionMode: 'PAPER',
          paperTradingConfig: {
            slippageEnabled: true,
            maxSlippageBps: 2,
            spreadSimulation: true,
            latencyMs: 100,
            partialFillsEnabled: false,
            rejectionRate: 0.01,
            fillRule: 'IMMEDIATE'
          }
        };
      
      case 'MT5':
        return {
          executionMode: 'MT5'
          // Future: MT5 specific config
        };
      
      case 'REST':
        return {
          executionMode: 'REST'
          // Future: REST specific config
        };
      
      default:
        throw new Error(`Unsupported execution mode: ${executionMode}`);
    }
  }
}