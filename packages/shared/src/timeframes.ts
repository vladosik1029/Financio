export type TimeframeId =
  | "5s"
  | "10s"
  | "15s"
  | "30s"
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

export interface Timeframe {
  id: TimeframeId;
  seconds: number;
  /**
   * Интервал свечей в REST API Binance Futures. У секундных таймфреймов его нет:
   * такие свечи сервер собирает сам из потока сделок.
   */
  binanceInterval?: string;
}

export const TIMEFRAMES: readonly Timeframe[] = [
  { id: "5s", seconds: 5 },
  { id: "10s", seconds: 10 },
  { id: "15s", seconds: 15 },
  { id: "30s", seconds: 30 },
  { id: "1m", seconds: 60, binanceInterval: "1m" },
  { id: "5m", seconds: 300, binanceInterval: "5m" },
  { id: "15m", seconds: 900, binanceInterval: "15m" },
  { id: "1h", seconds: 3600, binanceInterval: "1h" },
  { id: "4h", seconds: 14400, binanceInterval: "4h" },
  { id: "1d", seconds: 86400, binanceInterval: "1d" },
];

const byId = new Map(TIMEFRAMES.map((t) => [t.id, t]));

export function getTimeframe(id: string): Timeframe | undefined {
  return byId.get(id as TimeframeId);
}

export function isSecondTimeframe(tf: Timeframe): boolean {
  return tf.seconds < 60;
}

/** Начало свечи (в мс), в которую попадает момент времени `ts` */
export function candleOpenTime(ts: number, tf: Timeframe): number {
  const ms = tf.seconds * 1000;
  return Math.floor(ts / ms) * ms;
}
