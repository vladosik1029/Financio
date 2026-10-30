import { getTimeframe } from "@financio/shared";
import { describe, expect, it } from "vitest";
import { CandleAggregator } from "./candles.js";

const tf5s = getTimeframe("5s")!;
const tf1m = getTimeframe("1m")!;
const T0 = 1_700_000_000_000; // кратно и 5 с, и минуте

describe("CandleAggregator", () => {
  it("собирает OHLCV внутри одной свечи", () => {
    const agg = new CandleAggregator([tf5s]);
    agg.addTrade("BTCUSDT", 100, 1, T0);
    agg.addTrade("BTCUSDT", 105, 2, T0 + 1000);
    agg.addTrade("BTCUSDT", 98, 1, T0 + 2000);
    agg.addTrade("BTCUSDT", 101, 1, T0 + 4999);
    expect(agg.getCandles("BTCUSDT", "5s")).toEqual([
      { time: T0, open: 100, high: 105, low: 98, close: 101, volume: 5 },
    ]);
  });

  it("открывает новую свечу и заполняет пропуски", () => {
    const agg = new CandleAggregator([tf5s]);
    agg.addTrade("BTCUSDT", 100, 1, T0);
    agg.addTrade("BTCUSDT", 110, 1, T0 + 15_000);
    const candles = agg.getCandles("BTCUSDT", "5s");
    expect(candles.map((c) => c.time)).toEqual([T0, T0 + 5000, T0 + 10_000, T0 + 15_000]);
    expect(candles[1]).toMatchObject({ open: 100, close: 100, volume: 0 });
    expect(candles[3]).toMatchObject({ open: 110, close: 110 });
  });

  it("игнорирует сделки из прошлых свечей", () => {
    const agg = new CandleAggregator([tf5s]);
    agg.addTrade("BTCUSDT", 100, 1, T0 + 5000);
    agg.addTrade("BTCUSDT", 50, 1, T0);
    expect(agg.getCandles("BTCUSDT", "5s")).toHaveLength(1);
    expect(agg.last("BTCUSDT", "5s")?.low).toBe(100);
  });

  it("подкладывает историю из REST под живые свечи", () => {
    const agg = new CandleAggregator([tf1m]);
    agg.addTrade("ETHUSDT", 3000, 1, T0 + 60_000);
    agg.seed("ETHUSDT", tf1m, [
      { time: T0, open: 2990, high: 3001, low: 2985, close: 2999, volume: 10 },
      { time: T0 + 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }, // перекрыта живой
    ]);
    const candles = agg.getCandles("ETHUSDT", "1m");
    expect(candles.map((c) => c.close)).toEqual([2999, 3000]);
  });

  it("уведомляет подписчиков", () => {
    const agg = new CandleAggregator([tf5s, tf1m]);
    const seen: string[] = [];
    agg.onUpdate((s, tf, c) => seen.push(`${s}:${tf}:${c.close}`));
    agg.addTrade("SOLUSDT", 150, 1, T0);
    expect(seen).toEqual(["SOLUSDT:5s:150", "SOLUSDT:1m:150"]);
  });
});
