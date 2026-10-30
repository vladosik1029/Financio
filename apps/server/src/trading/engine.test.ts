import type { ServerMessage, Ticker } from "@financio/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/index.js";
import { TradingEngine, type MarketView } from "./engine.js";
import { SettingsStore } from "./settings.js";

const USER = { id: 777, first_name: "Vlad" };
const HOUR = 3600_000;

class FakeMarket implements MarketView {
  stale = false;
  tickers = new Map<string, Ticker>();
  set(symbol: string, price: number, fundingRate = 0.0001) {
    this.tickers.set(symbol, { symbol, last: price, mark: price, fundingRate, nextFundingTime: 0, updatedAt: 0 });
  }
  getTicker(symbol: string) {
    return this.tickers.get(symbol);
  }
}

describe("TradingEngine", () => {
  let database: Database;
  let market: FakeMarket;
  let engine: TradingEngine;
  let now: number;
  let events: { userId: number; msg: ServerMessage }[];

  // Одна встроенная база на файл: поднимать её на каждый тест долго
  beforeAll(async () => {
    database = await openDatabase("pglite://memory");
  });

  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE ledger, positions, users, settings RESTART IDENTITY CASCADE`);
    market = new FakeMarket();
    market.set("BTCUSDT", 50_000);
    market.set("SOLUSDT", 150);
    now = Date.UTC(2026, 9, 30, 10, 0, 0);
    events = [];
    engine = new TradingEngine(
      database.db,
      market,
      new SettingsStore(database.db),
      (userId, msg) => events.push({ userId, msg }),
      () => now,
    );
    await engine.init();
    await engine.ensureUser(USER);
  });

  afterAll(async () => {
    await database.close();
  });

  const balance = async () => (await engine.getProfile(USER.id)).balance;
  const open = (over: Partial<Parameters<TradingEngine["openPosition"]>[1]> = {}) =>
    engine.openPosition(USER.id, { symbol: "BTCUSDT", side: "long", margin: 100, leverage: 10, ...over });

  it("новый игрок получает стартовый баланс", async () => {
    const profile = await engine.getProfile(USER.id);
    expect(profile).toMatchObject({ balance: 1000, level: 1, maxLeverage: 50, canTakeLoan: false });
  });

  it("открытие списывает маржу и комиссию, цена входа с проскальзыванием", async () => {
    const p = await open();
    expect(p.entryPrice).toBeCloseTo(50_005, 6);
    expect(p.quantity).toBeCloseTo(1000 / 50_005, 10);
    expect(p.openFee).toBeCloseTo(0.5, 10);
    expect(p.liquidationPrice).toBeCloseTo(50_005 * (1 - 0.1 + 0.005), 6);
    expect(await balance()).toBeCloseTo(899.5, 6);
    expect(events.map((e) => e.msg.type)).toEqual(["position", "balance"]);
  });

  it("закрытие с прибылью возвращает маржу + PnL − комиссию", async () => {
    const p = await open();
    market.set("BTCUSDT", 51_000);
    const closed = await engine.closePosition(USER.id, p.id);
    const exit = 51_000 * (1 - 0.0001);
    const pnl = (exit - p.entryPrice) * p.quantity;
    const fee = p.quantity * exit * 0.0005;
    expect(closed.status).toBe("closed");
    expect(closed.realizedPnl).toBeCloseTo(pnl - fee - p.openFee, 6);
    expect(await balance()).toBeCloseTo(899.5 + 100 + pnl - fee, 6);
    expect(await engine.listPositions(USER.id, "open")).toHaveLength(0);
    expect(await engine.listPositions(USER.id, "history")).toHaveLength(1);
  });

  it("ликвидация по mark price забирает всю маржу", async () => {
    const p = await open({ leverage: 50 });
    engine.onMark("BTCUSDT", p.liquidationPrice - 1);
    await vi.waitFor(async () => expect((await engine.listPositions(USER.id, "history"))[0]?.status).toBe("liquidated"));
    const [h] = await engine.listPositions(USER.id, "history");
    expect(h!.closeReason).toBe("liquidation");
    expect(h!.realizedPnl).toBeCloseTo(-100 - p.openFee, 6);
    expect(await balance()).toBeCloseTo(1000 - 100 - p.openFee, 6);
  });

  it("Take Profit и Stop Loss закрывают позицию", async () => {
    const a = await open({ takeProfit: 52_000 });
    const b = await open({ side: "short", stopLoss: 51_000 });
    engine.onMark("BTCUSDT", 52_100);
    await vi.waitFor(async () => expect(await engine.listPositions(USER.id, "history")).toHaveLength(2));
    const history = await engine.listPositions(USER.id, "history");
    expect(history.find((h) => h.id === a.id)?.closeReason).toBe("take_profit");
    expect(history.find((h) => h.id === b.id)?.closeReason).toBe("stop_loss");
  });

  it("проверяет ордер", async () => {
    await expect(open({ margin: 5000 })).rejects.toMatchObject({ code: "insufficient_balance" });
    await expect(open({ leverage: 60 })).rejects.toMatchObject({ code: "bad_leverage" });
    await expect(open({ leverage: 4 })).rejects.toMatchObject({ code: "bad_leverage" });
    await expect(open({ symbol: "SOLUSDT" })).rejects.toMatchObject({ code: "coin_locked" });
    await expect(open({ takeProfit: 49_000 })).rejects.toMatchObject({ code: "bad_take_profit" });
    await expect(open({ stopLoss: 40_000 })).rejects.toMatchObject({ code: "bad_stop_loss" });
    market.stale = true;
    await expect(open()).rejects.toMatchObject({ code: "market_stale" });
    expect(await balance()).toBe(1000);
  });

  it("funding раз в 8 часов меняет маржу и цену ликвидации", async () => {
    const p = await open();
    expect(await engine.processFunding()).toBe(0); // первый запуск только запоминает слот
    now += 8 * HOUR;
    expect(await engine.processFunding()).toBe(1);
    const [after] = await engine.listPositions(USER.id, "open");
    const payment = -p.quantity * 50_000 * 0.0001;
    expect(after!.fundingPaid).toBeCloseTo(payment, 8);
    expect(after!.margin).toBeCloseTo(100 + payment, 8);
    expect(after!.liquidationPrice).toBeGreaterThan(p.liquidationPrice);
    expect(await engine.processFunding()).toBe(0); // тот же слот повторно не списывается
  });

  it("добавление маржи отодвигает ликвидацию", async () => {
    const p = await open({ leverage: 20 });
    const after = await engine.addMargin(USER.id, p.id, 100);
    expect(after.margin).toBe(200);
    expect(after.invested).toBe(200);
    expect(after.liquidationPrice).toBeLessThan(p.liquidationPrice);
  });

  it("кредит наставника доступен банкроту раз в сутки", async () => {
    await expect(engine.takeLoan(USER.id)).rejects.toMatchObject({ code: "loan_unavailable" });
    const p = await open({ margin: 990, leverage: 5 });
    engine.onMark("BTCUSDT", p.liquidationPrice - 1);
    await vi.waitFor(async () => expect(await engine.listPositions(USER.id, "open")).toHaveLength(0));
    expect((await engine.getProfile(USER.id)).canTakeLoan).toBe(true);
    const after = await engine.takeLoan(USER.id);
    expect(after).toBeGreaterThan(500);
    await expect(engine.takeLoan(USER.id)).rejects.toMatchObject({ code: "loan_unavailable" });
  });

  it("админ может поправить баланс, но не увести его в минус", async () => {
    expect(await engine.adminAdjustBalance(USER.id, 250, "компенсация")).toBe(1250);
    await expect(engine.adminAdjustBalance(USER.id, -5000, "штраф")).rejects.toMatchObject({ code: "insufficient_balance" });
  });

  it("позиции переживают перезапуск движка", async () => {
    const p = await open({ leverage: 50 });
    const restarted = new TradingEngine(database.db, market, new SettingsStore(database.db), () => {}, () => now);
    await restarted.init();
    expect(restarted.openCount).toBe(1);
    restarted.onMark("BTCUSDT", p.liquidationPrice - 1);
    await vi.waitFor(async () => expect(await restarted.listPositions(USER.id, "open")).toHaveLength(0));
  });
});
