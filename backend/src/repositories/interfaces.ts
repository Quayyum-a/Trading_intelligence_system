import type { Candle } from '../types/database.js';

export interface ICandleRepository {
  insertCandle(candle: Candle): Promise<void>;
  getCandlesByPairAndTimeframe(
    pair: string,
    timeframe: string,
    limit?: number
  ): Promise<Candle[]>;
}
