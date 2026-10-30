import { dailyQuests, type ServerMessage, type Ticker } from "@financio/shared";
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
    await database.db.execute(sql`TRUNCATE ledger, user_items, user_skills, quest_claims, orders, positions, users, settings RESTART IDENTITY CASCADE`);
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

  describe("отложенные ордера", () => {
    const place = (over: Partial<Parameters<TradingEngine["placeOrder"]>[1]> = {}) =>
      engine.placeOrder(USER.id, {
        symbol: "BTCUSDT",
        side: "long",
        type: "limit",
        price: 49_000,
        margin: 100,
        leverage: 10,
        ...over,
      });

    it("лимит резервирует деньги и исполняется ровно по своей цене с комиссией maker", async () => {
      const order = await place({ takeProfit: 52_000 });
      expect(order.reserved).toBeCloseTo(100.5);
      expect(await balance()).toBeCloseTo(1000 - 100.5);

      engine.onMark("BTCUSDT", 49_500);
      expect(await engine.listOrders(USER.id, "pending")).toHaveLength(1);

      engine.onMark("BTCUSDT", 48_990);
      await vi.waitFor(async () => expect(await engine.listPositions(USER.id, "open")).toHaveLength(1));
      const [pos] = await engine.listPositions(USER.id, "open");
      expect(pos!.entryPrice).toBe(49_000);
      expect(pos!.openFee).toBeCloseTo(1000 * 0.0002);
      expect(pos!.takeProfit).toBe(52_000);
      // Вернулась разница между зарезервированной taker-комиссией и фактической maker
      expect(await balance()).toBeCloseTo(1000 - 100 - 0.2);
      const [filled] = await engine.listOrders(USER.id, "history");
      expect(filled).toMatchObject({ status: "filled", positionId: pos!.id });
      expect(events.some((e) => e.msg.type === "order" && e.msg.event === "filled")).toBe(true);
    });

    it("стоп входит по рынку на пробое уровня", async () => {
      await place({ type: "stop", side: "short", price: 48_000 });
      engine.onMark("BTCUSDT", 48_500);
      expect(await engine.listPositions(USER.id, "open")).toHaveLength(0);
      engine.onMark("BTCUSDT", 47_900);
      await vi.waitFor(async () => expect(await engine.listPositions(USER.id, "open")).toHaveLength(1));
      const [pos] = await engine.listPositions(USER.id, "open");
      expect(pos!.side).toBe("short");
      expect(pos!.entryPrice).toBeLessThan(47_900);
      expect(pos!.openFee).toBeCloseTo(1000 * 0.0005);
    });

    it("не даёт выставить ордер, который исполнился бы сразу", async () => {
      await expect(place({ price: 51_000 })).rejects.toMatchObject({ code: "bad_order_price" });
      await expect(place({ type: "stop", price: 49_000 })).rejects.toMatchObject({ code: "bad_order_price" });
      await expect(place({ margin: 5000 })).rejects.toMatchObject({ code: "insufficient_balance" });
    });

    it("отмена возвращает весь резерв, чужой ордер отменить нельзя", async () => {
      const order = await place();
      await engine.ensureUser({ id: 778, first_name: "Other" });
      await expect(engine.cancelOrder(778, order.id)).rejects.toMatchObject({ code: "not_found" });
      const cancelled = await engine.cancelOrder(USER.id, order.id);
      expect(cancelled.status).toBe("cancelled");
      expect(await balance()).toBeCloseTo(1000);
      engine.onMark("BTCUSDT", 48_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(await engine.listPositions(USER.id, "open")).toHaveLength(0);
    });

    it("ордер переживает перезапуск движка", async () => {
      await place();
      const restarted = new TradingEngine(database.db, market, new SettingsStore(database.db), () => {}, () => now);
      await restarted.init();
      restarted.onMark("BTCUSDT", 48_000);
      await vi.waitFor(async () => expect(await restarted.listPositions(USER.id, "open")).toHaveLength(1));
    });
  });

  describe("опыт и квесты", () => {
    const profile = () => engine.getProfile(USER.id);
    /** Ближайшие сутки (в то же время дня), в которые выпадают нужные квесты */
    const dayWith = (from: number, ...ids: string[]) => {
      let day = from;
      while (!ids.every((id) => dailyQuests(day).some((q) => q.id === id))) day += 24 * HOUR;
      return day;
    };

    it("прибыльная сделка даёт опыт, слишком короткая — нет", async () => {
      now = dayWith(now, "profit");
      const quick = await open();
      market.set("BTCUSDT", 51_000);
      await engine.closePosition(USER.id, quick.id);
      await new Promise((r) => setTimeout(r, 50));
      expect((await profile()).xp).toBe(0);

      market.set("BTCUSDT", 50_000);
      const p = await open();
      now += 60_000;
      market.set("BTCUSDT", 51_000);
      await engine.closePosition(USER.id, p.id);
      // ~+18% к марже: 15 + 9 XP, плюс квест «закрой сделку в плюс» +40
      await vi.waitFor(async () => expect((await profile()).xp).toBe(64));
      const progress = events.filter((e) => e.msg.type === "progress");
      expect(progress.map((e) => (e.msg as { reason: string }).reason)).toEqual(["trade", "quest"]);
    });

    it("квесты дня награждают один раз, новый уровень даёт бонус на баланс", async () => {
      now = dayWith(now, "trades", "stopLoss");
      for (let i = 0; i < 3; i++) await open({ stopLoss: 49_000 });
      // «3 сделки» (30) + «со стоп-лоссом» (30)
      await vi.waitFor(async () => expect((await profile()).xp).toBe(60));
      await open({ stopLoss: 49_000 });
      await new Promise((r) => setTimeout(r, 50));
      const p = await profile();
      expect(p.xp).toBe(60);
      expect(p.quests.filter((q) => q.done).map((q) => q.id)).toEqual(["trades", "stopLoss"]);

      // Следующие сутки: квесты заново
      now = dayWith(now + 24 * HOUR, "trades", "stopLoss");
      expect((await profile()).quests.every((q) => !q.done)).toBe(true);
      const before = (await profile()).balance;
      for (let i = 0; i < 3; i++) await open({ stopLoss: 49_000 });
      // 60 + 30 + 30 = 120: уровень 2, остаток 20 XP и бонус $100
      await vi.waitFor(async () => expect((await profile()).level).toBe(2));
      expect((await profile()).xp).toBe(20);
      expect((await profile()).balance).toBeCloseTo(before - 3 * 100.5 + 100);
    });

    it("квесты сменяются: в другой день засчитываются другие действия", async () => {
      now = dayWith(now, "longShort");
      await open();
      expect((await profile()).quests.find((q) => q.id === "longShort")?.progress).toBe(1);
      await open({ side: "short" });
      await vi.waitFor(async () => expect((await profile()).quests.find((q) => q.id === "longShort")?.done).toBe(true));
    });
  });

  describe("экипировка и навыки", () => {
    it("покупка списывает деньги, надевает вещь и даёт скидку на комиссию", async () => {
      const state = await engine.rpg.buy(USER.id, "second_monitor");
      expect(state.equipped.monitor).toBe("second_monitor");
      expect(await balance()).toBe(700);
      const p = await open();
      expect(p.openFee).toBeCloseTo(1000 * 0.0005 * 0.95);
      await expect(engine.rpg.buy(USER.id, "second_monitor")).rejects.toMatchObject({ code: "already_owned" });
      await expect(engine.rpg.buy(USER.id, "ultrawide")).rejects.toMatchObject({ code: "item_locked" });
    });

    it("в слоте одна вещь: надевание другой снимает прежнюю", async () => {
      await database.db.execute(sql`UPDATE users SET level = 5, balance = 10000`);
      await engine.rpg.buy(USER.id, "second_monitor");
      const second = await engine.rpg.buy(USER.id, "ultrawide");
      // Слот был занят: новая вещь лежит в инвентаре
      expect(second.equipped.monitor).toBe("second_monitor");
      const equipped = await engine.rpg.equip(USER.id, "ultrawide");
      expect(equipped.equipped.monitor).toBe("ultrawide");
      expect(equipped.effects.feeDiscount).toBeCloseTo(0.1);
      const off = await engine.rpg.unequip(USER.id, "ultrawide");
      expect(off.effects.feeDiscount).toBe(0);
    });

    it("навыки качаются за очки уровня", async () => {
      await expect(engine.rpg.upgradeSkill(USER.id, "analyst")).rejects.toMatchObject({ code: "no_skill_points" });
      await database.db.execute(sql`UPDATE users SET level = 3`);
      await engine.rpg.upgradeSkill(USER.id, "risk_manager").catch((e) => expect(e.code).toBe("skill_locked"));
      await engine.rpg.upgradeSkill(USER.id, "discipline");
      const state = await engine.rpg.upgradeSkill(USER.id, "discipline");
      expect(state.skills.discipline).toBe(2);
      expect(state.skillPoints).toBe(0);
      expect((await engine.getProfile(USER.id)).takerFeeRate).toBeCloseTo(0.0005 * 0.94);
    });
  });
});
