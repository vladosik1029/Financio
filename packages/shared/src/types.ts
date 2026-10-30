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
  | { type: "pong" };
