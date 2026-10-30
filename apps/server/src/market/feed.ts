import type { Candle, Timeframe } from "@financio/shared";

export interface FeedHandlers {
  onTrade(symbol: string, price: number, quantity: number, ts: number): void;
  onMark(symbol: string, mark: number, fundingRate: number, nextFundingTime: number, ts: number): void;
}

/** Источник рыночных данных: живая биржа или симуляция для разработки */
export interface PriceFeed {
  readonly name: string;
  start(handlers: FeedHandlers): void;
  stop(): void;
  /** История свечей минутных и старших таймфреймов, если источник её отдаёт */
  fetchHistory?(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>;
}
