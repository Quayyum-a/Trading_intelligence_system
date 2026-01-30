import { logger } from '../config/logger.js';

/**
 * Trading Session Filter Utility
 *
 * Determines whether timestamps fall within configured trading windows.
 * Handles timezone conversions and supports different session configurations.
 */

export interface TradingSession {
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number; // 0-23
  endMinute: number; // 0-59
  timezone: string; // e.g., 'UTC', 'America/New_York'
  daysOfWeek: number[]; // 0-6, Sunday=0, Monday=1, etc.
}

export interface TradingSessionConfig {
  name: string;
  sessions: TradingSession[];
  enabled: boolean;
}

export class TradingSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingSessionError';
  }
}

export class TradingSessionFilter {
  private config: TradingSessionConfig;

  constructor(config?: TradingSessionConfig) {
    this.config = config || this.getDefaultConfig();
    this.validateConfig();
  }

  /**
   * Checks if a timestamp falls within any configured trading session
   */
  isWithinTradingHours(timestamp: Date): boolean {
    if (!this.config.enabled) {
      return true; // If filtering is disabled, all times are valid
    }

    for (const session of this.config.sessions) {
      if (this.isWithinSession(timestamp, session)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if a timestamp falls within a specific trading session
   */
  isWithinSession(timestamp: Date, session: TradingSession): boolean {
    try {
      // Convert timestamp to session timezone
      const sessionTime = this.convertToTimezone(timestamp, session.timezone);

      // Check day of week
      const dayOfWeek = sessionTime.getUTCDay();
      if (!session.daysOfWeek.includes(dayOfWeek)) {
        return false;
      }

      // Get time components
      const hour = sessionTime.getUTCHours();
      const minute = sessionTime.getUTCMinutes();
      const timeInMinutes = hour * 60 + minute;

      // Calculate session start and end in minutes
      const sessionStart = session.startHour * 60 + session.startMinute;
      const sessionEnd = session.endHour * 60 + session.endMinute;

      // Handle sessions that cross midnight
      if (sessionEnd < sessionStart) {
        // Session crosses midnight (e.g., 22:00 to 06:00)
        return timeInMinutes >= sessionStart || timeInMinutes <= sessionEnd;
      } else {
        // Normal session within same day
        return timeInMinutes >= sessionStart && timeInMinutes <= sessionEnd;
      }
    } catch (error) {
      logger.error('Error checking trading session', {
        timestamp: timestamp.toISOString(),
        session,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Gets the next trading session start time
   */
  getNextTradingSession(timestamp: Date): Date | null {
    if (!this.config.enabled || this.config.sessions.length === 0) {
      return null;
    }

    let nextSessionStart: Date | null = null;

    for (const session of this.config.sessions) {
      const nextStart = this.getNextSessionStart(timestamp, session);
      if (nextStart && (!nextSessionStart || nextStart < nextSessionStart)) {
        nextSessionStart = nextStart;
      }
    }

    return nextSessionStart;
  }

  /**
   * Filters an array of timestamps to only include those within trading hours
   */
  filterTradingHours(timestamps: Date[]): Date[] {
    return timestamps.filter(timestamp => this.isWithinTradingHours(timestamp));
  }

  /**
   * Gets statistics about how many timestamps fall within/outside trading hours
   */
  getFilteringStats(timestamps: Date[]): {
    total: number;
    withinTradingHours: number;
    outsideTradingHours: number;
    percentageFiltered: number;
  } {
    const total = timestamps.length;
    const withinTradingHours = timestamps.filter(t =>
      this.isWithinTradingHours(t)
    ).length;
    const outsideTradingHours = total - withinTradingHours;
    const percentageFiltered =
      total > 0 ? (outsideTradingHours / total) * 100 : 0;

    return {
      total,
      withinTradingHours,
      outsideTradingHours,
      percentageFiltered: Math.round(percentageFiltered * 100) / 100,
    };
  }

  /**
   * Updates the trading session configuration
   */
  updateConfig(newConfig: TradingSessionConfig): void {
    this.config = newConfig;
    this.validateConfig();

    logger.info('Trading session configuration updated', {
      configName: this.config.name,
      enabled: this.config.enabled,
      sessionsCount: this.config.sessions.length,
    });
  }

  /**
   * Gets the current configuration
   */
  getConfig(): TradingSessionConfig {
    return JSON.parse(JSON.stringify(this.config)); // Deep copy
  }

  /**
   * Converts a timestamp to a specific timezone
   */
  private convertToTimezone(timestamp: Date, timezone: string): Date {
    if (timezone === 'UTC') {
      return new Date(timestamp.getTime());
    }

    try {
      // Use Intl.DateTimeFormat to handle timezone conversion
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(timestamp);
      const partsObj = parts.reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {} as any);

      // Create new date in the target timezone
      const converted = new Date(
        parseInt(partsObj.year),
        parseInt(partsObj.month) - 1, // Month is 0-indexed
        parseInt(partsObj.day),
        parseInt(partsObj.hour),
        parseInt(partsObj.minute),
        parseInt(partsObj.second)
      );

      return converted;
    } catch (error) {
      logger.error('Timezone conversion failed', {
        timestamp: timestamp.toISOString(),
        timezone,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Fallback to UTC if conversion fails
      return new Date(timestamp.getTime());
    }
  }

  /**
   * Gets the next session start time for a specific session
   */
  private getNextSessionStart(timestamp: Date, session: TradingSession): Date {
    const sessionTime = this.convertToTimezone(timestamp, session.timezone);
    const currentDay = sessionTime.getUTCDay();

    // Try today first
    if (session.daysOfWeek.includes(currentDay)) {
      const todayStart = new Date(sessionTime);
      todayStart.setUTCHours(session.startHour, session.startMinute, 0, 0);

      if (todayStart > sessionTime) {
        return todayStart;
      }
    }

    // Look for next valid day
    for (let i = 1; i <= 7; i++) {
      const nextDay = new Date(sessionTime);
      nextDay.setUTCDate(nextDay.getUTCDate() + i);
      const nextDayOfWeek = nextDay.getUTCDay();

      if (session.daysOfWeek.includes(nextDayOfWeek)) {
        nextDay.setUTCHours(session.startHour, session.startMinute, 0, 0);
        return nextDay;
      }
    }

    // This should never happen if session has valid days
    throw new TradingSessionError(
      'No valid trading days found in session configuration'
    );
  }

  /**
   * Validates the trading session configuration
   */
  private validateConfig(): void {
    if (!this.config.name) {
      throw new TradingSessionError(
        'Trading session configuration must have a name'
      );
    }

    if (!Array.isArray(this.config.sessions)) {
      throw new TradingSessionError('Sessions must be an array');
    }

    for (const session of this.config.sessions) {
      this.validateSession(session);
    }
  }

  /**
   * Validates a single trading session
   */
  private validateSession(session: TradingSession): void {
    // Validate hours
    if (session.startHour < 0 || session.startHour > 23) {
      throw new TradingSessionError(
        `Invalid start hour: ${session.startHour}. Must be 0-23.`
      );
    }
    if (session.endHour < 0 || session.endHour > 23) {
      throw new TradingSessionError(
        `Invalid end hour: ${session.endHour}. Must be 0-23.`
      );
    }

    // Validate minutes
    if (session.startMinute < 0 || session.startMinute > 59) {
      throw new TradingSessionError(
        `Invalid start minute: ${session.startMinute}. Must be 0-59.`
      );
    }
    if (session.endMinute < 0 || session.endMinute > 59) {
      throw new TradingSessionError(
        `Invalid end minute: ${session.endMinute}. Must be 0-59.`
      );
    }

    // Validate days of week
    if (!Array.isArray(session.daysOfWeek) || session.daysOfWeek.length === 0) {
      throw new TradingSessionError('Days of week must be a non-empty array');
    }

    for (const day of session.daysOfWeek) {
      if (day < 0 || day > 6) {
        throw new TradingSessionError(
          `Invalid day of week: ${day}. Must be 0-6.`
        );
      }
    }

    // Validate timezone
    if (!session.timezone) {
      throw new TradingSessionError('Timezone is required');
    }
  }

  /**
   * Gets the default trading session configuration (14:00-18:00 UTC, weekdays)
   */
  private getDefaultConfig(): TradingSessionConfig {
    return {
      name: 'Default Trading Session',
      enabled: true,
      sessions: [
        {
          startHour: 14,
          startMinute: 0,
          endHour: 18,
          endMinute: 0,
          timezone: 'UTC',
          daysOfWeek: [1, 2, 3, 4, 5], // Monday to Friday
        },
      ],
    };
  }
}

/**
 * Factory function to create a trading session filter with default configuration
 */
export function createDefaultTradingSessionFilter(): TradingSessionFilter {
  return new TradingSessionFilter();
}

/**
 * Factory function to create a trading session filter for XAU/USD (14:00-18:00 UTC)
 */
export function createXauUsdTradingSessionFilter(): TradingSessionFilter {
  const config: TradingSessionConfig = {
    name: 'XAU/USD Trading Session',
    enabled: true,
    sessions: [
      {
        startHour: 14,
        startMinute: 0,
        endHour: 18,
        endMinute: 0,
        timezone: 'UTC',
        daysOfWeek: [1, 2, 3, 4, 5], // Monday to Friday
      },
    ],
  };

  return new TradingSessionFilter(config);
}
