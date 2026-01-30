/**
 * Paper Broker Adapter - Simulates realistic execution behavior for testing and development
 */

import { BaseBrokerAdapter } from './base-broker.adapter';
import { 
  AccountInfo, 
  BrokerPosition, 
  ExecutionReport, 
  OrderRequest, 
  OrderResponse, 
  OrderStatus,
  PaperTradingConfig 
} from '../types/execution.types';
import { getLogger } from '../../config/logger';
const logger = getLogger();

interface PaperOrder {
  id: string;
  request: OrderRequest;
  status: OrderStatus;
  filledPrice?: number;
  filledSize?: number;
  createdAt: Date;
  filledAt?: Date;
}

interface PaperPositionData {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  marginUsed: number;
  openedAt: Date;
}

export class PaperBrokerAdapter extends BaseBrokerAdapter {
  private config: PaperTradingConfig;
  private orders: Map<string, PaperOrder> = new Map();
  private positions: Map<string, PaperPositionData> = new Map();
  private mockAccountBalance: number = 10000; // $10,000 default balance

  constructor(config: PaperTradingConfig) {
    super();
    this.config = config;
    logger.info('Paper broker adapter initialized', { config });
  }

  /**
   * Connect to the paper trading environment
   */
  async connect(): Promise<void> {
    try {
      // Simulate connection delay
      await this.delay(this.config.latencyMs);
      
      this.isConnected = true;
      this.accountInfo = await this.validateAccount();
      
      logger.info('Paper broker connected successfully');
    } catch (error) {
      logger.error('Failed to connect to paper broker', { error });
      throw error;
    }
  }

  /**
   * Disconnect from the paper trading environment
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.accountInfo = null;
    this.orders.clear();
    this.positions.clear();
    
    logger.info('Paper broker disconnected');
  }

  /**
   * Validate account and return mock account information
   */
  async validateAccount(): Promise<AccountInfo> {
    this.ensureConnected();

    const totalMarginUsed = Array.from(this.positions.values())
      .reduce((sum, pos) => sum + pos.marginUsed, 0);

    const equity = this.mockAccountBalance + Array.from(this.positions.values())
      .reduce((sum, pos) => sum + pos.unrealizedPnL, 0);

    const freeMargin = this.mockAccountBalance - totalMarginUsed;
    const marginLevel = totalMarginUsed > 0 ? (equity / totalMarginUsed) * 100 : 0;

    this.accountInfo = {
      accountId: 'PAPER_ACCOUNT_001',
      balance: this.mockAccountBalance,
      equity,
      margin: totalMarginUsed,
      freeMargin,
      marginLevel
    };

    return this.accountInfo;
  }

  /**
   * Place an order with realistic simulation
   */
  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    this.ensureConnected();
    this.validateOrderRequest(order);

    const orderId = this.generateOrderId();
    
    // Simulate order rejection based on rejection rate
    if (Math.random() < this.config.rejectionRate) {
      const response: OrderResponse = {
        orderId,
        status: 'REJECTED',
        timestamp: new Date()
      };

      logger.warn('Paper order rejected', { orderId, order });
      return response;
    }

    // Create paper order
    const paperOrder: PaperOrder = {
      id: orderId,
      request: order,
      status: 'PENDING',
      createdAt: new Date()
    };

    this.orders.set(orderId, paperOrder);

    // Simulate execution based on fill rule
    const executionResult = await this.simulateExecution(paperOrder);
    
    // Update order with execution result
    paperOrder.status = executionResult.status;
    paperOrder.filledPrice = executionResult.filledPrice;
    paperOrder.filledSize = executionResult.filledSize;
    paperOrder.filledAt = executionResult.timestamp;

    // Create execution report if filled
    if (executionResult.status === 'FILLED' && executionResult.filledPrice && executionResult.filledSize) {
      const executionReport: ExecutionReport = {
        orderId,
        tradeId: orderId, // In real implementation, this would come from the trade
        filledPrice: executionResult.filledPrice,
        filledSize: executionResult.filledSize,
        slippage: this.calculateSlippage(order.price || executionResult.filledPrice, executionResult.filledPrice),
        timestamp: executionResult.timestamp
      };

      // Create position if this is an opening order
      await this.createPosition(order, executionReport);

      // Notify execution callbacks
      setTimeout(() => {
        this.notifyExecutionCallbacks(executionReport);
      }, this.config.latencyMs);
    }

    this.logOperation('placeOrder', order, executionResult);
    return executionResult;
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<void> {
    this.ensureConnected();

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status === 'FILLED') {
      throw new Error(`Cannot cancel filled order ${orderId}`);
    }

    order.status = 'CANCELLED';
    this.logOperation('cancelOrder', { orderId });
  }

  /**
   * Get the status of an order
   */
  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    this.ensureConnected();

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return order.status;
  }

  /**
   * Get all open positions
   */
  async getOpenPositions(): Promise<BrokerPosition[]> {
    this.ensureConnected();

    return Array.from(this.positions.values()).map(pos => ({
      positionId: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      currentPrice: pos.currentPrice,
      unrealizedPnL: pos.unrealizedPnL,
      marginUsed: pos.marginUsed
    }));
  }

  /**
   * Close a specific position
   */
  async closePosition(positionId: string): Promise<void> {
    this.ensureConnected();

    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Create closing order
    const closeOrder: OrderRequest = {
      symbol: position.symbol,
      side: position.side === 'BUY' ? 'SELL' : 'BUY',
      size: position.size,
      type: 'MARKET'
    };

    // Execute closing order
    await this.placeOrder(closeOrder);
    
    // Remove position
    this.positions.delete(positionId);
    
    this.logOperation('closePosition', { positionId });
  }

  /**
   * Simulate order execution based on configuration
   */
  private async simulateExecution(order: PaperOrder): Promise<OrderResponse> {
    // Simulate latency
    await this.delay(this.config.latencyMs);

    let fillPrice = order.request.price || this.getMockMarketPrice(order.request.symbol);

    // Apply slippage if enabled
    if (this.config.slippageEnabled) {
      // Generate random slippage within the maximum allowed range
      const maxSlippageAmount = (fillPrice * this.config.maxSlippageBps) / 10000;
      const slippageAmount = Math.random() * maxSlippageAmount; // 0 to maxSlippageAmount
      
      // Apply slippage in the direction that hurts the trader
      if (order.request.side === 'BUY') {
        fillPrice += slippageAmount;
      } else {
        fillPrice -= slippageAmount;
      }
    }

    // Apply spread simulation if enabled
    if (this.config.spreadSimulation) {
      const spread = this.getMockSpread(order.request.symbol);
      if (order.request.side === 'BUY') {
        fillPrice += spread / 2;
      } else {
        fillPrice -= spread / 2;
      }
    }

    // Handle partial fills if enabled
    let fillSize = order.request.size;
    if (this.config.partialFillsEnabled && Math.random() < 0.3) { // 30% chance of partial fill
      fillSize = order.request.size * (0.5 + Math.random() * 0.5); // 50-100% fill
    }

    return {
      orderId: order.id,
      status: 'FILLED',
      filledPrice: Math.round(fillPrice * 100000) / 100000, // Round to 5 decimal places
      filledSize: Math.round(fillSize * 100) / 100, // Round to 2 decimal places
      timestamp: new Date()
    };
  }

  /**
   * Create a position from a filled order
   */
  private async createPosition(order: OrderRequest, execution: ExecutionReport): Promise<void> {
    const positionId = this.generateOrderId();
    const marginUsed = (execution.filledSize * execution.filledPrice) / 100; // Assume 100:1 leverage

    const position: PaperPositionData = {
      id: positionId,
      symbol: order.symbol,
      side: order.side,
      size: execution.filledSize,
      entryPrice: execution.filledPrice,
      currentPrice: execution.filledPrice,
      unrealizedPnL: 0,
      marginUsed,
      openedAt: execution.timestamp
    };

    this.positions.set(positionId, position);
    
    logger.info('Paper position created', {
      positionId,
      symbol: order.symbol,
      side: order.side,
      size: execution.filledSize,
      entryPrice: execution.filledPrice
    });
  }

  /**
   * Get mock market price for a symbol
   */
  private getMockMarketPrice(symbol: string): number {
    // Mock prices for common symbols
    const mockPrices: Record<string, number> = {
      'XAUUSD': 2000 + (Math.random() - 0.5) * 100,
      'EURUSD': 1.1000 + (Math.random() - 0.5) * 0.02,
      'GBPUSD': 1.3000 + (Math.random() - 0.5) * 0.02,
      'USDJPY': 150.00 + (Math.random() - 0.5) * 2
    };

    return mockPrices[symbol] || 1.0000;
  }

  /**
   * Get mock spread for a symbol
   */
  private getMockSpread(symbol: string): number {
    // Mock spreads in the quote currency
    const mockSpreads: Record<string, number> = {
      'XAUUSD': 0.50,
      'EURUSD': 0.00015,
      'GBPUSD': 0.00020,
      'USDJPY': 0.015
    };

    return mockSpreads[symbol] || 0.0001;
  }

  /**
   * Calculate slippage between requested and filled price
   */
  private calculateSlippage(requestedPrice: number, filledPrice: number): number {
    return Math.abs(filledPrice - requestedPrice);
  }

  /**
   * Simulate delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update account balance (for testing purposes)
   */
  setAccountBalance(balance: number): void {
    this.mockAccountBalance = balance;
    logger.info('Paper account balance updated', { balance });
  }

  /**
   * Get current orders (for testing purposes)
   */
  getCurrentOrders(): PaperOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Clear all orders and positions (for testing purposes)
   */
  reset(): void {
    this.orders.clear();
    this.positions.clear();
    this.mockAccountBalance = 10000;
    logger.info('Paper broker adapter reset');
  }
}