import { describe, expect, it } from "vitest";
import { candleOpenTime, getTimeframe, isSecondTimeframe } from "./timeframes.js";

describe("таймфреймы", () => {
  it("секундные таймфреймы не имеют интервала Binance", () => {
    const tf = getTimeframe("5s")!;
    expect(isSecondTimeframe(tf)).toBe(true);
    expect(tf.binanceInterval).toBeUndefined();
    expect(getTimeframe("1m")!.binanceInterval).toBe("1m");
  });

  it("округляет время до начала свечи", () => {
    const tf = getTimeframe("10s")!;
    expect(candleOpenTime(1_700_000_007_500, tf)).toBe(1_700_000_000_000);
  });
});
