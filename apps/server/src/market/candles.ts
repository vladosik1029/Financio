import {
  candleOpenTime,
  TIMEFRAMES,
  type Candle,
  type Timeframe,
  type TimeframeId,
} from "@financio/shared";

/** Сколько секундных свечей держим в памяти: последние 6 часов */
const SECOND_HISTORY_MS = 6 * 60 * 60 * 1000;
/** Минимальная глубина для минутных и старших таймфреймов */
const MIN_CAPACITY = 1000;

function capacityFor(tf: Timeframe): number {
  return Math.max(MIN_CAPACITY, Math.ceil(SECOND_HISTORY_MS / (tf.seconds * 1000)));
}

export type CandleListener = (symbol: string, tf: TimeframeId, candle: Candle) => void;

/**
 * Собирает свечи всех таймфреймов из потока сделок.
 * Для секундных таймфреймов это единственный источник истории,
 * для минутных и старших — текущая (незакрытая) свеча поверх истории из REST.
 */
export class CandleAggregator {
  private readonly series = new Map<string, Candle[]>();
  private readonly listeners = new Set<CandleListener>();

  constructor(private readonly timeframes: readonly Timeframe[] = TIMEFRAMES) {}

  onUpdate(listener: CandleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Учитывает сделку во всех таймфреймах символа */
  addTrade(symbol: string, price: number, quantity: number, ts: number): void {
    for (const tf of this.timeframes) {
      const candle = this.apply(symbol, tf, price, quantity, ts);
      if (candle) for (const l of this.listeners) l(symbol, tf.id, candle);
    }
  }

  /** Подкладывает историю (например, из REST) под уже собранные свечи */
  seed(symbol: string, tf: Timeframe, history: Candle[]): void {
    const key = keyOf(symbol, tf.id);
    const current = this.series.get(key) ?? [];
    const firstLive = current[0]?.time ?? Infinity;
    const merged = [...history.filter((c) => c.time < firstLive), ...current];
    this.series.set(key, merged.slice(-capacityFor(tf)));
  }

  getCandles(symbol: string, tf: TimeframeId, limit = 500): Candle[] {
    const list = this.series.get(keyOf(symbol, tf)) ?? [];
    return list.slice(-limit).map((c) => ({ ...c }));
  }

  last(symbol: string, tf: TimeframeId): Candle | undefined {
    const list = this.series.get(keyOf(symbol, tf));
    return list?.[list.length - 1];
  }

  private apply(
    symbol: string,
    tf: Timeframe,
    price: number,
    quantity: number,
    ts: number,
  ): Candle | undefined {
    const key = keyOf(symbol, tf.id);
    let list = this.series.get(key);
    if (!list) {
      list = [];
      this.series.set(key, list);
    }
    const openTime = candleOpenTime(ts, tf);
    const last = list[list.length - 1];

    if (last && openTime < last.time) return undefined; // опоздавшая сделка

    if (last && last.time === openTime) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += quantity;
      return last;
    }

    // Пустые интервалы без сделок заполняем плоскими свечами, чтобы на графике не было дыр
    if (last) {
      const step = tf.seconds * 1000;
      for (let t = last.time + step; t < openTime; t += step) {
        list.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 });
      }
    }

    const candle: Candle = { time: openTime, open: price, high: price, low: price, close: price, volume: quantity };
    list.push(candle);
    const cap = capacityFor(tf);
    if (list.length > cap) list.splice(0, list.length - cap);
    return candle;
  }
}

function keyOf(symbol: string, tf: TimeframeId): string {
  return `${symbol}:${tf}`;
}
