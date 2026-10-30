import { COINS, getTimeframe, isSecondTimeframe, type Candle, type Ticker, type TimeframeId } from "@financio/shared";
import { CandleAggregator, type CandleListener } from "./candles.js";
import type { PriceFeed } from "./feed.js";

/** Сколько мс без данных считать цену устаревшей: открывать сделки по ней нельзя */
const STALE_AFTER_MS = 10_000;
/** Как часто перезапрашивать историю минутных свечей из REST */
const HISTORY_TTL_MS = 60_000;

/** Единая точка правды о рынке: последние цены, mark price, funding и свечи */
export class MarketHub {
  readonly candles = new CandleAggregator();
  private readonly tickers = new Map<string, Ticker>();
  private readonly historyLoadedAt = new Map<string, number>();
  private lastDataAt = 0;
  private readonly markListeners = new Set<(symbol: string, mark: number) => void>();

  constructor(
    private readonly feed: PriceFeed,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    this.feed.start({
      onTrade: (symbol, price, qty, ts) => {
        this.lastDataAt = Date.now();
        this.candles.addTrade(symbol, price, qty, ts);
        const t = this.ticker(symbol);
        t.last = price;
        if (!t.mark) t.mark = price;
        t.updatedAt = ts;
      },
      onMark: (symbol, mark, fundingRate, nextFundingTime, ts) => {
        this.lastDataAt = Date.now();
        const t = this.ticker(symbol);
        t.mark = mark;
        t.fundingRate = fundingRate;
        t.nextFundingTime = nextFundingTime;
        t.updatedAt = Math.max(t.updatedAt, ts);
        for (const l of this.markListeners) l(symbol, mark);
      },
    });
  }

  stop(): void {
    this.feed.stop();
  }

  get feedName(): string {
    return this.feed.name;
  }

  get stale(): boolean {
    return Date.now() - this.lastDataAt > STALE_AFTER_MS;
  }

  getTickers(): Ticker[] {
    return COINS.map((c) => this.tickers.get(c.symbol)).filter((t): t is Ticker => !!t && t.last > 0);
  }

  getTicker(symbol: string): Ticker | undefined {
    return this.tickers.get(symbol);
  }

  /** Подписка на каждое обновление mark price: по нему движок проверяет ликвидации и TP/SL */
  onMark(listener: (symbol: string, mark: number) => void): () => void {
    this.markListeners.add(listener);
    return () => this.markListeners.delete(listener);
  }

  onCandle(listener: CandleListener): () => void {
    return this.candles.onUpdate(listener);
  }

  async getCandles(symbol: string, tfId: TimeframeId, limit = 500): Promise<Candle[]> {
    const tf = getTimeframe(tfId);
    if (!tf) return [];
    if (!isSecondTimeframe(tf) && this.feed.fetchHistory) {
      const key = `${symbol}:${tf.id}`;
      const loadedAt = this.historyLoadedAt.get(key) ?? 0;
      if (Date.now() - loadedAt > HISTORY_TTL_MS) {
        try {
          this.candles.seed(symbol, tf, await this.feed.fetchHistory(symbol, tf, limit));
          this.historyLoadedAt.set(key, Date.now());
        } catch (err) {
          this.log(`История ${key} не загрузилась: ${(err as Error).message}`);
        }
      }
    }
    return this.candles.getCandles(symbol, tf.id, limit);
  }

  private ticker(symbol: string): Ticker {
    let t = this.tickers.get(symbol);
    if (!t) {
      t = { symbol, last: 0, mark: 0, fundingRate: 0, nextFundingTime: 0, updatedAt: 0 };
      this.tickers.set(symbol, t);
    }
    return t;
  }
}
