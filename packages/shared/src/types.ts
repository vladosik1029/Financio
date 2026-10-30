import type { QuestId, QuestState } from "./progress.js";
import type { TimeframeId } from "./timeframes.js";

export type Side = "long" | "short";

export interface Candle {
  /** Время открытия свечи, мс */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  /** Цена последней сделки */
  last: number;
  /** Mark price: по ней считаются PnL и ликвидации */
  mark: number;
  /** Текущая ставка funding (доля, 0.0001 = 0,01%) */
  fundingRate: number;
  /** Время следующего списания funding, мс */
  nextFundingTime: number;
  updatedAt: number;
}

/** Сообщения от клиента к серверу по WebSocket */
export type ClientMessage =
  | { type: "subscribe"; symbol: string; tf: TimeframeId }
  | { type: "unsubscribe"; symbol: string; tf: TimeframeId }
  | { type: "ping" };

/** Сообщения от сервера к клиенту по WebSocket */
export type ServerMessage =
  | { type: "tickers"; tickers: Ticker[]; stale: boolean }
  | { type: "candle"; symbol: string; tf: TimeframeId; candle: Candle }
  | { type: "error"; message: string }
  | { type: "pong" }
  /** Личные события игрока: приходят только при подключении с initData */
  | { type: "position"; event: "opened" | "updated" | "closed"; position: Position }
  | { type: "order"; event: OrderEvent; order: Order }
  /** Начислен опыт: за сделку или квест; при новом уровне приходит и бонус на баланс */
  | {
      type: "progress";
      reason: "trade" | "quest";
      questId?: QuestId;
      gained: number;
      level: number;
      xp: number;
      xpToNext: number;
      levelsGained: number[];
      bonus: number;
    }
  | { type: "balance"; balance: number };

export type PositionStatus = "open" | "closed" | "liquidated";

/**
 * Типы ордеров. market — сразу по рынку; limit — по указанной цене или лучше
 * (лонг ниже рынка, шорт выше), комиссия maker; stop — рыночный вход, когда цена
 * дойдёт до триггера (лонг на пробой вверх, шорт на пробой вниз), комиссия taker.
 */
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus = "pending" | "filled" | "cancelled" | "rejected";
export type OrderEvent = "placed" | "filled" | "cancelled" | "rejected";

/** Отложенный ордер: маржа и комиссия зарезервированы с баланса до исполнения или отмены */
export interface Order {
  id: number;
  symbol: string;
  side: Side;
  type: Exclude<OrderType, "market">;
  status: OrderStatus;
  /** Лимитная цена или цена триггера */
  price: number;
  margin: number;
  leverage: number;
  takeProfit: number | null;
  stopLoss: number | null;
  /** Сколько списано с баланса: маржа плюс максимальная комиссия */
  reserved: number;
  positionId: number | null;
  /** Код причины отклонения при исполнении (TradeErrorCode) */
  rejectReason: string | null;
  createdAt: number;
  updatedAt: number;
}
export type CloseReason = "manual" | "take_profit" | "stop_loss" | "liquidation" | "admin";

export interface Position {
  id: number;
  symbol: string;
  side: Side;
  status: PositionStatus;
  leverage: number;
  /** Текущая изолированная маржа (меняется от funding и добавления маржи) */
  margin: number;
  /** Сколько всего денег игрок вложил в позицию: начальная + добавленная маржа */
  invested: number;
  quantity: number;
  entryPrice: number;
  liquidationPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  openFee: number;
  closeFee: number;
  /** Сумма funding: плюс — получено, минус — заплачено */
  fundingPaid: number;
  exitPrice: number | null;
  /** Итог сделки за вычетом комиссий и funding */
  realizedPnl: number | null;
  closeReason: CloseReason | null;
  openedAt: number;
  closedAt: number | null;
}

export interface Profile {
  level: number;
  xp: number;
  xpToNext: number;
  balance: number;
  minLeverage: number;
  maxLeverage: number;
  maxOpenPositions: number;
  takerFeeRate: number;
  canTakeLoan: boolean;
  loanAmount: number;
  /** Квесты дня с прогрессом, считает сервер */
  quests: QuestState[];
}

/** Настройки игры, которые меняются из админки */
export interface GameSettings {
  tradingEnabled: boolean;
  takerFeeRate: number;
  startingBalance: number;
  maxOpenPositions: number;
  /** Кредит наставника при банкротстве */
  loanAmount: number;
  /** Баланс, ниже которого игрок считается банкротом */
  loanThreshold: number;
  loanCooldownHours: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  tradingEnabled: true,
  takerFeeRate: 0.0005,
  startingBalance: 1000,
  maxOpenPositions: 10,
  loanAmount: 500,
  loanThreshold: 50,
  loanCooldownHours: 24,
};

/** Коды ошибок торговых операций: клиент переводит их на язык игрока */
export type TradeErrorCode =
  | "trading_disabled"
  | "market_stale"
  | "unknown_symbol"
  | "coin_locked"
  | "bad_leverage"
  | "bad_margin"
  | "insufficient_balance"
  | "too_many_positions"
  | "bad_take_profit"
  | "bad_stop_loss"
  | "not_found"
  | "rate_limited"
  | "banned"
  | "loan_unavailable"
  | "bad_order_price"
  | "too_many_orders";

export interface OpenPositionRequest {
  symbol: string;
  side: Side;
  /** По умолчанию market */
  type?: OrderType;
  /** Для limit и stop */
  price?: number | null;
  margin: number;
  leverage: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
}
