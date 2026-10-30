import type { FeedHandlers, PriceFeed } from "./feed.js";

/** Примерные стартовые цены и волатильность (σ за секунду) для симуляции */
const PRESETS: Record<string, { price: number; vol: number }> = {
  BTCUSDT: { price: 70_000, vol: 0.0004 },
  ETHUSDT: { price: 3_500, vol: 0.0005 },
  SOLUSDT: { price: 160, vol: 0.0007 },
  BNBUSDT: { price: 600, vol: 0.0004 },
  XRPUSDT: { price: 0.6, vol: 0.0006 },
  DOGEUSDT: { price: 0.15, vol: 0.0008 },
  TONUSDT: { price: 5.5, vol: 0.0007 },
  LINKUSDT: { price: 15, vol: 0.0007 },
};

/**
 * Случайное блуждание цены для локальной разработки без доступа к бирже.
 * При старте прогоняет `historySec` секунд истории, чтобы график не был пустым.
 */
export class MockFeed implements PriceFeed {
  readonly name = "mock";
  private timer?: NodeJS.Timeout;
  private readonly prices = new Map<string, number>();

  constructor(
    private readonly symbols: readonly string[],
    private readonly historySec = 2 * 60 * 60,
    private readonly random: () => number = Math.random,
  ) {
    for (const s of symbols) this.prices.set(s, PRESETS[s]?.price ?? 100);
  }

  start(handlers: FeedHandlers): void {
    const now = Date.now();
    for (let t = now - this.historySec * 1000; t < now; t += 1000) this.tick(handlers, t, 1);
    this.timer = setInterval(() => this.tick(handlers, Date.now(), 0.25), 250);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private tick(handlers: FeedHandlers, ts: number, dtSec: number): void {
    for (const s of this.symbols) {
      const vol = (PRESETS[s]?.vol ?? 0.0005) * Math.sqrt(dtSec);
      const prev = this.prices.get(s)!;
      const next = prev * Math.exp(vol * this.gaussian());
      this.prices.set(s, next);
      handlers.onTrade(s, next, this.random() * 2, ts);
      handlers.onMark(s, next, 0.0001, nextFundingTime(ts), ts);
    }
  }

  private gaussian(): number {
    const u = 1 - this.random();
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function nextFundingTime(ts: number): number {
  const period = 8 * 60 * 60 * 1000;
  return Math.floor(ts / period) * period + period;
}
