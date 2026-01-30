export interface Candle {
  id?: string;
  pair: string;
  timeframe: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  created_at?: Date;
}

export interface Trade {
  id?: string;
  pair: string;
  side: 'buy' | 'sell';
  entry_price: number;
  quantity: number;
  entry_timestamp: Date;
  exit_price?: number;
  exit_timestamp?: Date;
  status: 'open' | 'closed';
  profit_loss?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface TradeExit {
  exit_price: number;
  exit_timestamp: Date;
  profit_loss: number;
}

export interface DatabaseError extends Error {
  code?: string;
  details?: string;
}
