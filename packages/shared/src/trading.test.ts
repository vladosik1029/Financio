import { describe, expect, it } from "vitest";
import {
  checkLeverage,
  fillPrice,
  liquidationPriceForMargin,
  stopLossHit,
  takeProfitHit,
  fundingPayment,
  isLiquidated,
  liquidationPrice,
  maintenanceMarginRate,
  maxLeverageForLevel,
  positionQuantity,
  returnOnEquity,
  tradingFee,
  unrealizedPnl,
} from "./trading.js";

describe("плечо", () => {
  it("лимит зависит от уровня", () => {
    expect(maxLeverageForLevel(1)).toBe(50);
    expect(maxLeverageForLevel(9)).toBe(50);
    expect(maxLeverageForLevel(10)).toBe(100);
    expect(maxLeverageForLevel(19)).toBe(100);
    expect(maxLeverageForLevel(20)).toBe(150);
  });

  it("проверяет шаг, минимум и лимит уровня", () => {
    expect(checkLeverage(25, 1)).toEqual({ ok: true });
    expect(checkLeverage(4, 1).reason).toBe("too_low");
    expect(checkLeverage(12.5, 1).reason).toBe("not_integer");
    expect(checkLeverage(51, 1).reason).toBe("too_high_for_level");
    expect(checkLeverage(150, 20)).toEqual({ ok: true });
  });

  it("MMR ниже для плеча выше 100x", () => {
    expect(maintenanceMarginRate(100)).toBe(0.005);
    expect(maintenanceMarginRate(101)).toBe(0.003);
  });
});

describe("ликвидация", () => {
  it("лонг BTC по 70 000 с 20x ликвидируется около 66 850", () => {
    expect(liquidationPrice("long", 70_000, 20)).toBeCloseTo(66_850, 6);
  });

  it("шорт зеркален лонгу", () => {
    expect(liquidationPrice("short", 70_000, 20)).toBeCloseTo(73_150, 6);
  });

  it("на 150x хватает движения примерно на 0,37%", () => {
    const liq = liquidationPrice("long", 100, 150);
    expect(1 - liq / 100).toBeCloseTo(1 / 150 - 0.003, 10);
  });

  it("срабатывает по mark price", () => {
    expect(isLiquidated("long", 66_800, 66_850)).toBe(true);
    expect(isLiquidated("long", 66_900, 66_850)).toBe(false);
    expect(isLiquidated("short", 73_200, 73_150)).toBe(true);
  });
});

describe("PnL, комиссии, funding", () => {
  it("считает PnL и ROE", () => {
    const qty = positionQuantity(100, 10, 50_000); // $1000 позиции = 0.02 BTC
    expect(qty).toBeCloseTo(0.02, 10);
    const pnl = unrealizedPnl("long", 50_000, 51_000, qty);
    expect(pnl).toBeCloseTo(20, 10);
    expect(returnOnEquity(pnl, 100)).toBeCloseTo(0.2, 10);
    expect(unrealizedPnl("short", 50_000, 51_000, qty)).toBeCloseTo(-20, 10);
  });

  it("taker-комиссия 0,05% от объёма", () => {
    expect(tradingFee(10_000)).toBeCloseTo(5, 10);
  });

  it("при положительной ставке лонг платит, шорт получает", () => {
    expect(fundingPayment("long", 10_000, 0.0001)).toBeCloseTo(-1, 10);
    expect(fundingPayment("short", 10_000, 0.0001)).toBeCloseTo(1, 10);
  });
});

describe("маржа, проскальзывание, TP/SL", () => {
  it("цена ликвидации по марже совпадает с формулой по плечу", () => {
    const qty = positionQuantity(100, 20, 70_000);
    expect(liquidationPriceForMargin("long", 70_000, qty, 100, 0.005)).toBeCloseTo(liquidationPrice("long", 70_000, 20), 6);
    expect(liquidationPriceForMargin("short", 70_000, qty, 100, 0.005)).toBeCloseTo(liquidationPrice("short", 70_000, 20), 6);
  });

  it("добавленная маржа отодвигает ликвидацию", () => {
    const qty = positionQuantity(100, 20, 70_000);
    expect(liquidationPriceForMargin("long", 70_000, qty, 200, 0.005)).toBeLessThan(liquidationPrice("long", 70_000, 20));
  });

  it("покупка исполняется дороже, продажа дешевле", () => {
    expect(fillPrice("long", "open", 100, 1000)).toBeCloseTo(100.01, 10);
    expect(fillPrice("long", "close", 100, 1000)).toBeCloseTo(99.99, 10);
    expect(fillPrice("short", "open", 100, 1000)).toBeCloseTo(99.99, 10);
    expect(fillPrice("short", "close", 100, 200_000)).toBeCloseTo(100.05, 10);
  });

  it("TP и SL срабатывают в нужную сторону", () => {
    expect(takeProfitHit("long", 110, 110)).toBe(true);
    expect(takeProfitHit("short", 110, 90)).toBe(false);
    expect(stopLossHit("long", 89, 90)).toBe(true);
    expect(stopLossHit("short", 89, 90)).toBe(false);
    expect(stopLossHit("long", 89, null)).toBe(false);
  });
});
