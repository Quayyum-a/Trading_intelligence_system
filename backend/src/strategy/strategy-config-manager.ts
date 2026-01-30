import type { StrategyConfig, ConfidenceWeights } from './strategy.types.js';
import { DEFAULT_STRATEGY_CONFIG, validateStrategyConfig, loadConfigFromEnv } from './strategy.config.js';
import { StrategyConfigurationError } from './strategy-validation.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface ConfigChangeEvent {
  timestamp: Date;
  changes: Partial<StrategyConfig>;
  previousConfig: StrategyConfig;
  newConfig: StrategyConfig;
  source: 'FILE' | 'ENV' | 'API' | 'RUNTIME';
}

export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

/**
 * Manages strategy configuration with validation, persistence, and hot reloading
 */
export class StrategyConfigManager {
  private currentConfig: StrategyConfig;
  private configFilePath: string;
  private listeners: ConfigChangeListener[] = [];
  private watchInterval?: NodeJS.Timeout;

  constructor(configFilePath?: string) {
    this.configFilePath = configFilePath || path.join(process.cwd(), 'strategy-config.json');
    this.currentConfig = { ...DEFAULT_STRATEGY_CONFIG };
  }

  /**
   * Initialize configuration manager
   */
  async initialize(): Promise<void> {
    try {
      // Load configuration from multiple sources in priority order
      await this.loadConfiguration();
      
      // Start watching for file changes if config file exists
      if (existsSync(this.configFilePath)) {
        this.startFileWatcher();
      }
    } catch (error) {
      throw new StrategyConfigurationError(
        `Failed to initialize configuration manager: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'INITIALIZATION'
      );
    }
  }

  /**
   * Load configuration from multiple sources
   */
  private async loadConfiguration(): Promise<void> {
    let config = { ...DEFAULT_STRATEGY_CONFIG };

    // 1. Start with defaults
    console.log('Loading default configuration');

    // 2. Override with environment variables
    const envConfig = loadConfigFromEnv();
    if (Object.keys(envConfig).length > 0) {
      config = this.mergeConfigs(config, envConfig);
      console.log('Applied environment variable overrides');
    }

    // 3. Override with file configuration
    if (existsSync(this.configFilePath)) {
      try {
        const fileConfig = await this.loadFromFile();
        config = this.mergeConfigs(config, fileConfig);
        console.log(`Applied configuration from ${this.configFilePath}`);
      } catch (error) {
        console.warn(`Failed to load config file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Validate final configuration
    const validationErrors = validateStrategyConfig(config);
    if (validationErrors.length > 0) {
      throw new StrategyConfigurationError(
        `Configuration validation failed: ${validationErrors.join(', ')}`,
        'VALIDATION',
        validationErrors
      );
    }

    this.currentConfig = config;
  }

  /**
   * Load configuration from file
   */
  private async loadFromFile(): Promise<Partial<StrategyConfig>> {
    try {
      const fileContent = await readFile(this.configFilePath, 'utf-8');
      const config = JSON.parse(fileContent);
      
      // Validate JSON structure
      if (typeof config !== 'object' || config === null) {
        throw new Error('Configuration file must contain a valid JSON object');
      }

      return config;
    } catch (error) {
      throw new StrategyConfigurationError(
        `Failed to load configuration file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FILE_LOAD',
        { filePath: this.configFilePath }
      );
    }
  }

  /**
   * Save configuration to file
   */
  async saveToFile(config?: StrategyConfig): Promise<void> {
    const configToSave = config || this.currentConfig;
    
    try {
      const configJson = JSON.stringify(configToSave, null, 2);
      await writeFile(this.configFilePath, configJson, 'utf-8');
      console.log(`Configuration saved to ${this.configFilePath}`);
    } catch (error) {
      throw new StrategyConfigurationError(
        `Failed to save configuration file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FILE_SAVE',
        { filePath: this.configFilePath }
      );
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.currentConfig };
  }

  /**
   * Update configuration with validation
   */
  async updateConfig(changes: Partial<StrategyConfig>, source: 'FILE' | 'ENV' | 'API' | 'RUNTIME' = 'RUNTIME'): Promise<void> {
    const previousConfig = { ...this.currentConfig };
    const newConfig = this.mergeConfigs(this.currentConfig, changes);

    // Validate new configuration
    const validationErrors = validateStrategyConfig(newConfig);
    if (validationErrors.length > 0) {
      throw new StrategyConfigurationError(
        `Configuration update validation failed: ${validationErrors.join(', ')}`,
        'UPDATE_VALIDATION',
        { changes, validationErrors }
      );
    }

    // Apply changes
    this.currentConfig = newConfig;

    // Notify listeners
    const event: ConfigChangeEvent = {
      timestamp: new Date(),
      changes,
      previousConfig,
      newConfig,
      source
    };

    this.notifyListeners(event);

    // Save to file if not from file source
    if (source !== 'FILE') {
      await this.saveToFile();
    }
  }

  /**
   * Update specific configuration section
   */
  async updateRiskConfig(riskConfig: Partial<StrategyConfig['risk']>): Promise<void> {
    await this.updateConfig({
      risk: { ...this.currentConfig.risk, ...riskConfig }
    });
  }

  async updateConfidenceConfig(confidenceConfig: Partial<StrategyConfig['confidence']>): Promise<void> {
    await this.updateConfig({
      confidence: { ...this.currentConfig.confidence, ...confidenceConfig }
    });
  }

  async updateTradingWindow(windowConfig: Partial<StrategyConfig['tradingWindow']>): Promise<void> {
    await this.updateConfig({
      tradingWindow: { ...this.currentConfig.tradingWindow, ...windowConfig }
    });
  }

  /**
   * Reset configuration to defaults
   */
  async resetToDefaults(): Promise<void> {
    await this.updateConfig(DEFAULT_STRATEGY_CONFIG);
  }

  /**
   * Merge configuration objects with deep merge for nested objects
   */
  private mergeConfigs(base: StrategyConfig, override: Partial<StrategyConfig>): StrategyConfig {
    const merged = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Deep merge for nested objects
          merged[key as keyof StrategyConfig] = {
            ...merged[key as keyof StrategyConfig] as any,
            ...value
          };
        } else {
          // Direct assignment for primitives and arrays
          merged[key as keyof StrategyConfig] = value as any;
        }
      }
    }

    return merged;
  }

  /**
   * Add configuration change listener
   */
  addChangeListener(listener: ConfigChangeListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove configuration change listener
   */
  removeChangeListener(listener: ConfigChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of configuration changes
   */
  private notifyListeners(event: ConfigChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in configuration change listener:', error);
      }
    });
  }

  /**
   * Start file watcher for hot reloading
   */
  private startFileWatcher(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }

    let lastModified = 0;

    this.watchInterval = setInterval(async () => {
      try {
        if (existsSync(this.configFilePath)) {
          const stats = await import('fs').then(fs => fs.promises.stat(this.configFilePath));
          const modified = stats.mtime.getTime();

          if (modified > lastModified) {
            lastModified = modified;
            console.log('Configuration file changed, reloading...');
            
            const fileConfig = await this.loadFromFile();
            await this.updateConfig(fileConfig, 'FILE');
          }
        }
      } catch (error) {
        console.error('Error watching configuration file:', error);
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop file watcher
   */
  stopFileWatcher(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
    }
  }

  /**
   * Validate specific configuration parameters
   */
  validateParameter(parameter: keyof StrategyConfig, value: any): string[] {
    const testConfig = { ...this.currentConfig };
    testConfig[parameter] = value;
    
    return validateStrategyConfig(testConfig);
  }

  /**
   * Get configuration schema for validation
   */
  getConfigSchema(): any {
    return {
      pair: { type: 'string', required: true },
      timeframe: { type: 'string', required: true },
      tradingWindow: {
        type: 'object',
        required: true,
        properties: {
          start: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          end: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          timezone: { type: 'string', required: true }
        }
      },
      risk: {
        type: 'object',
        required: true,
        properties: {
          riskPerTrade: { type: 'number', min: 0, max: 0.1 },
          maxConcurrentTrades: { type: 'number', min: 1 },
          leverage: { type: 'number', min: 1, max: 500 },
          minRRRatio: { type: 'number', min: 1 },
          accountBalance: { type: 'number', min: 0 }
        }
      },
      confidence: {
        type: 'object',
        required: true,
        properties: {
          minThreshold: { type: 'number', min: 0, max: 1 },
          components: {
            type: 'object',
            required: true,
            properties: {
              emaAlignment: { type: 'number', min: 0, max: 1 },
              structureQuality: { type: 'number', min: 0, max: 1 },
              atrContext: { type: 'number', min: 0, max: 1 },
              timeOfDay: { type: 'number', min: 0, max: 1 },
              rrQuality: { type: 'number', min: 0, max: 1 }
            }
          }
        }
      }
    };
  }

  /**
   * Export configuration for backup
   */
  exportConfig(): string {
    return JSON.stringify(this.currentConfig, null, 2);
  }

  /**
   * Import configuration from JSON string
   */
  async importConfig(configJson: string, source: 'FILE' | 'ENV' | 'API' | 'RUNTIME' = 'API'): Promise<void> {
    try {
      const config = JSON.parse(configJson);
      await this.updateConfig(config, source);
    } catch (error) {
      throw new StrategyConfigurationError(
        `Failed to import configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'IMPORT',
        { configJson }
      );
    }
  }

  /**
   * Get configuration diff between current and provided config
   */
  getConfigDiff(otherConfig: StrategyConfig): any {
    const diff: any = {};
    
    const compareObjects = (obj1: any, obj2: any, path: string = ''): void => {
      for (const key in obj1) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof obj1[key] === 'object' && obj1[key] !== null && !Array.isArray(obj1[key])) {
          if (typeof obj2[key] === 'object' && obj2[key] !== null) {
            compareObjects(obj1[key], obj2[key], currentPath);
          } else {
            diff[currentPath] = { current: obj1[key], other: obj2[key] };
          }
        } else if (obj1[key] !== obj2[key]) {
          diff[currentPath] = { current: obj1[key], other: obj2[key] };
        }
      }
    };

    compareObjects(this.currentConfig, otherConfig);
    return diff;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopFileWatcher();
    this.listeners = [];
  }
}