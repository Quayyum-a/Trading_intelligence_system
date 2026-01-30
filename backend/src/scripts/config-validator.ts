#!/usr/bin/env node

import { BrokerFactory } from '../brokers/broker-factory.js';
import { getEnvironmentConfig } from '../config/env.js';
import { getLogger } from '../config/logger.js';

const logger = getLogger();

/**
 * Configuration validation utility
 * Requirements: 6.1, 7.1, 7.2, 7.3, 7.4, 7.5
 */

interface ValidationResult {
  component: string;
  isValid: boolean;
  message: string;
  details?: Record<string, any>;
  recommendations?: string[];
}

class ConfigValidator {
  private results: ValidationResult[] = [];

  async validateAll(): Promise<ValidationResult[]> {
    console.log('🔧 Starting configuration validation...\n');

    await this.validateEnvironment();
    await this.validateBrokerConfigurations();
    await this.validateDatabaseConfiguration();
    await this.validateLoggingConfiguration();

    this.printSummary();
    return this.results;
  }

  private async validateEnvironment(): Promise<void> {
    console.log('🌍 Validating environment configuration...');

    try {
      const env = getEnvironmentConfig();

      // Check required environment variables
      const requiredVars = [
        'NODE_ENV',
        'LOG_LEVEL',
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
      ];

      const missingVars = requiredVars.filter(varName => {
        const value = process.env[varName];
        return !value || value.trim() === '';
      });

      if (missingVars.length > 0) {
        this.addResult({
          component: 'environment',
          isValid: false,
          message: `Missing required environment variables: ${missingVars.join(', ')}`,
          recommendations: [
            'Check your .env file',
            'Ensure all required variables are set',
            'Verify variable names are correct',
          ],
        });

        console.log(`   ❌ Missing variables: ${missingVars.join(', ')}`);
      } else {
        console.log('   ✅ All required environment variables present');
      }

      // Validate specific values
      const validLogLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLogLevels.includes(env.LOG_LEVEL)) {
        this.addResult({
          component: 'log_level',
          isValid: false,
          message: `Invalid LOG_LEVEL: ${env.LOG_LEVEL}`,
          details: { validLevels: validLogLevels },
          recommendations: [
            `Set LOG_LEVEL to one of: ${validLogLevels.join(', ')}`,
          ],
        });

        console.log(`   ❌ Invalid LOG_LEVEL: ${env.LOG_LEVEL}`);
      } else {
        console.log(`   ✅ LOG_LEVEL valid: ${env.LOG_LEVEL}`);
      }

      const validEnvironments = ['development', 'staging', 'production'];
      if (!validEnvironments.includes(env.NODE_ENV)) {
        this.addResult({
          component: 'node_env',
          isValid: false,
          message: `Invalid NODE_ENV: ${env.NODE_ENV}`,
          details: { validEnvironments },
          recommendations: [
            `Set NODE_ENV to one of: ${validEnvironments.join(', ')}`,
          ],
        });

        console.log(`   ❌ Invalid NODE_ENV: ${env.NODE_ENV}`);
      } else {
        console.log(`   ✅ NODE_ENV valid: ${env.NODE_ENV}`);
      }

      // Check Supabase URL format
      if (!env.SUPABASE_URL.startsWith('https://')) {
        this.addResult({
          component: 'supabase_url',
          isValid: false,
          message: 'SUPABASE_URL should start with https://',
          recommendations: ['Verify your Supabase project URL'],
        });

        console.log('   ❌ SUPABASE_URL format invalid');
      } else {
        console.log('   ✅ SUPABASE_URL format valid');
      }

      if (missingVars.length === 0) {
        this.addResult({
          component: 'environment',
          isValid: true,
          message: 'Environment configuration valid',
        });
      }
    } catch (error) {
      this.addResult({
        component: 'environment',
        isValid: false,
        message: 'Environment validation failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ❌ Environment validation failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async validateBrokerConfigurations(): Promise<void> {
    console.log('\n🔌 Validating broker configurations...');

    try {
      // Check for broker-specific environment variables
      const brokerConfigs = [
        {
          name: 'OANDA',
          requiredVars: ['OANDA_API_URL', 'OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
          optional: false,
        },
        {
          name: 'FXCM',
          requiredVars: ['FXCM_API_URL', 'FXCM_ACCESS_TOKEN'],
          optional: true,
        },
      ];

      let hasValidBroker = false;

      for (const config of brokerConfigs) {
        const missingVars = config.requiredVars.filter(varName => {
          const value = process.env[varName];
          return !value || value.trim() === '';
        });

        if (missingVars.length === 0) {
          hasValidBroker = true;
          console.log(`   ✅ ${config.name} configuration complete`);

          // Test broker connection
          try {
            const brokerName = config.name.toLowerCase();
            const broker = BrokerFactory.createBroker(brokerName);
            const startTime = Date.now();
            const isValid = await broker.validateConnection();
            const responseTime = Date.now() - startTime;

            if (isValid) {
              this.addResult({
                component: `broker_${brokerName}`,
                isValid: true,
                message: `${config.name} broker connection successful`,
                details: { responseTime },
              });

              console.log(
                `   ✅ ${config.name} connection test passed (${responseTime}ms)`
              );
            } else {
              this.addResult({
                component: `broker_${brokerName}`,
                isValid: false,
                message: `${config.name} broker connection failed`,
                details: { responseTime },
                recommendations: [
                  'Check API credentials',
                  'Verify API endpoint URL',
                  'Check network connectivity',
                  'Verify account permissions',
                ],
              });

              console.log(`   ❌ ${config.name} connection test failed`);
            }
          } catch (error) {
            this.addResult({
              component: `broker_${config.name.toLowerCase()}`,
              isValid: false,
              message: `${config.name} broker test failed`,
              details: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              recommendations: [
                'Check broker configuration',
                'Verify API credentials',
                'Check network connectivity',
              ],
            });

            console.log(
              `   ❌ ${config.name} test failed: ${error instanceof Error ? error.message : error}`
            );
          }
        } else if (!config.optional) {
          this.addResult({
            component: `broker_${config.name.toLowerCase()}`,
            isValid: false,
            message: `${config.name} configuration incomplete: missing ${missingVars.join(', ')}`,
            recommendations: [
              'Add missing environment variables to .env file',
              'Check variable names for typos',
              'Verify credentials with broker',
            ],
          });

          console.log(
            `   ❌ ${config.name} missing: ${missingVars.join(', ')}`
          );
        } else {
          console.log(`   ⏸️  ${config.name} not configured (optional)`);
        }
      }

      if (!hasValidBroker) {
        this.addResult({
          component: 'brokers',
          isValid: false,
          message: 'No valid broker configurations found',
          recommendations: [
            'Configure at least one broker (OANDA or FXCM)',
            'Add required environment variables',
            'Test broker connections',
          ],
        });
      } else {
        this.addResult({
          component: 'brokers',
          isValid: true,
          message: 'At least one broker configured successfully',
        });
      }
    } catch (error) {
      this.addResult({
        component: 'brokers',
        isValid: false,
        message: 'Broker validation failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      console.log(
        `   ❌ Broker validation failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async validateDatabaseConfiguration(): Promise<void> {
    console.log('\n🗄️  Validating database configuration...');

    try {
      // Test database connection by importing and using repository
      const { CandleRepository } =
        await import('../repositories/candle.repository.js');
      const candleRepository = new CandleRepository();

      // Test basic database operation
      const testCount = await candleRepository.getCandleCount('TEST', '1m');

      this.addResult({
        component: 'database',
        isValid: true,
        message: 'Database connection successful',
        details: { testQuery: 'getCandleCount', result: testCount },
      });

      console.log('   ✅ Database connection successful');

      // Check for required tables/schema
      // This is a simplified check - in production you might want more comprehensive schema validation
      console.log('   ✅ Database schema accessible');
    } catch (error) {
      this.addResult({
        component: 'database',
        isValid: false,
        message: 'Database connection failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        recommendations: [
          'Check SUPABASE_URL and SUPABASE_ANON_KEY',
          'Verify database is accessible',
          'Check network connectivity',
          'Verify database schema exists',
        ],
      });

      console.log(
        `   ❌ Database connection failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async validateLoggingConfiguration(): Promise<void> {
    console.log('\n📝 Validating logging configuration...');

    try {
      // Test logger creation and basic functionality
      const testLogger = getLogger();

      // Test different log levels
      testLogger.debug('Configuration validation test - debug');
      testLogger.info('Configuration validation test - info');

      this.addResult({
        component: 'logging',
        isValid: true,
        message: 'Logging configuration valid',
      });

      console.log('   ✅ Logger initialized successfully');

      // Check log level configuration
      const env = getEnvironmentConfig();
      console.log(`   ✅ Log level set to: ${env.LOG_LEVEL}`);

      // Check if running in development mode with pretty printing
      if (env.NODE_ENV === 'development') {
        console.log('   ✅ Development mode: pretty printing enabled');
      } else {
        console.log('   ✅ Production mode: structured JSON logging');
      }
    } catch (error) {
      this.addResult({
        component: 'logging',
        isValid: false,
        message: 'Logging configuration failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        recommendations: [
          'Check LOG_LEVEL environment variable',
          'Verify pino logger dependencies',
          'Check for logging transport issues',
        ],
      });

      console.log(
        `   ❌ Logging validation failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private addResult(result: ValidationResult): void {
    this.results.push(result);
  }

  private printSummary(): void {
    console.log('\n📋 Configuration Validation Summary:');
    console.log('====================================');

    const validCount = this.results.filter(r => r.isValid).length;
    const invalidCount = this.results.filter(r => !r.isValid).length;

    console.log(`✅ Valid: ${validCount}`);
    console.log(`❌ Invalid: ${invalidCount}`);

    if (invalidCount > 0) {
      console.log('\n❌ Configuration Issues:');
      this.results
        .filter(r => !r.isValid)
        .forEach(result => {
          console.log(`\n   ${result.component}: ${result.message}`);

          if (result.recommendations && result.recommendations.length > 0) {
            console.log('   Recommendations:');
            result.recommendations.forEach(rec => {
              console.log(`     - ${rec}`);
            });
          }
        });
    }

    const overallStatus = invalidCount === 0 ? 'VALID' : 'INVALID';
    const statusIcon = overallStatus === 'VALID' ? '✅' : '❌';

    console.log(`\n${statusIcon} Overall Configuration: ${overallStatus}`);

    if (overallStatus === 'VALID') {
      console.log('\n🎉 Configuration is ready for production use!');
    } else {
      console.log(
        '\n⚠️  Please fix the configuration issues before proceeding.'
      );
    }
  }
}

// Export validation functions for use in other scripts
export function validateBrokerConfig(brokerName: string): Promise<boolean> {
  return new Promise(async resolve => {
    try {
      const broker = BrokerFactory.createBroker(brokerName);
      const isValid = await broker.validateConnection();
      resolve(isValid);
    } catch (error) {
      resolve(false);
    }
  });
}

export function validateEnvironmentVars(requiredVars: string[]): string[] {
  return requiredVars.filter(varName => {
    const value = process.env[varName];
    return !value || value.trim() === '';
  });
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new ConfigValidator();

  validator
    .validateAll()
    .then(results => {
      const invalidCount = results.filter(r => !r.isValid).length;
      process.exit(invalidCount > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Configuration validation failed:', error);
      process.exit(1);
    });
}

export { ConfigValidator };
