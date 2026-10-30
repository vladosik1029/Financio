import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { signInitData } from "./auth/telegram.js";
import { UserChannels } from "./channels.js";
import { openDatabase, type Database } from "./db/index.js";
import { MarketHub } from "./market/hub.js";
import { MockFeed } from "./market/mock.js";
import { TradingEngine } from "./trading/engine.js";
import { SettingsStore } from "./trading/settings.js";

const BOT_TOKEN = "123456:TEST-TOKEN";
const ADMIN = { authorization: "Bearer test-admin-token-123456" };

function tma(id: number) {
  const initData = signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: `P${id}` }) },
    BOT_TOKEN,
  );
  return { authorization: `tma ${initData}` };
}

describe("API", () => {
  const hub = new MarketHub(new MockFeed(["BTCUSDT", "ETHUSDT"], 600));
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    hub.start();
    database = await openDatabase("pglite://memory");
    const settings = new SettingsStore(database.db);
    const engine = new TradingEngine(database.db, hub, settings);
    await engine.init();
    app = await buildApp({
      hub,
      db: database.db,
      engine,
      settings,
      channels: new UserChannels(),
      corsOrigins: [],
      adminToken: "test-admin-token-123456",
      adminIds: [42],
    });
  });
  afterAll(async () => {
    hub.stop();
    await app.close();
    await database.close();
  });

  it("отдаёт тикеры", async () => {
    const res = await app.inject({ url: "/api/tickers" });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.tickers.map((t: { symbol: string }) => t.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("отдаёт секундные свечи из симуляции", async () => {
    const res = await app.inject({ url: "/api/candles?symbol=BTCUSDT&tf=5s&limit=50" });
    expect(res.statusCode).toBe(200);
    expect(res.json().candles).toHaveLength(50);
  });

  it("проверяет параметры свечей", async () => {
    expect((await app.inject({ url: "/api/candles?symbol=FOO&tf=5s" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/candles?symbol=BTCUSDT&tf=7s" })).statusCode).toBe(404);
  });

  it("не пускает без Telegram", async () => {
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/positions", payload: {} })).statusCode).toBe(401);
  });

  it("создаёт игрока, открывает и закрывает сделку", async () => {
    const me = await app.inject({ url: "/api/me", headers: tma(10) });
    expect(me.json().profile.balance).toBe(1000);

    const opened = await app.inject({
      method: "POST",
      url: "/api/positions",
      headers: tma(10),
      payload: { symbol: "BTCUSDT", side: "short", margin: 50, leverage: 20 },
    });
    expect(opened.statusCode).toBe(200);
    const id = opened.json().position.id;

    const list = await app.inject({ url: "/api/positions?scope=open", headers: tma(10) });
    expect(list.json().positions.map((p: { id: number }) => p.id)).toEqual([id]);

    // Чужую позицию закрыть нельзя
    const foreign = await app.inject({ method: "POST", url: `/api/positions/${id}/close`, headers: tma(11) });
    expect(foreign.json()).toEqual({ error: "not_found" });

    const closed = await app.inject({ method: "POST", url: `/api/positions/${id}/close`, headers: tma(10) });
    expect(closed.json().position.status).toBe("closed");
  });

  it("возвращает код ошибки торговли", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/positions",
      headers: tma(12),
      payload: { symbol: "BTCUSDT", side: "long", margin: 50, leverage: 120 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_leverage" });
  });

  it("админка требует токен и умеет менять баланс и настройки", async () => {
    expect((await app.inject({ url: "/api/admin/stats" })).statusCode).toBe(401);
    const stats = await app.inject({ url: "/api/admin/stats", headers: ADMIN });
    expect(stats.json().users).toBeGreaterThan(0);

    const adj = await app.inject({
      method: "POST",
      url: "/api/admin/users/10/balance",
      headers: ADMIN,
      payload: { amount: 100, note: "тест" },
    });
    expect(adj.statusCode).toBe(200);

    const set = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: ADMIN,
      payload: { tradingEnabled: false },
    });
    expect(set.json().settings.tradingEnabled).toBe(false);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/positions",
      headers: tma(10),
      payload: { symbol: "BTCUSDT", side: "long", margin: 10, leverage: 10 },
    });
    expect(blocked.json()).toEqual({ error: "trading_disabled" });
  });

  it("пускает в админку из MiniApp только админов по Telegram ID", async () => {
    const admin = await app.inject({ url: "/api/me", headers: tma(42) });
    expect(admin.json().isAdmin).toBe(true);
    expect((await app.inject({ url: "/api/me", headers: tma(10) })).json().isAdmin).toBe(false);

    expect((await app.inject({ url: "/api/admin/stats", headers: tma(42) })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/admin/stats", headers: tma(10) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/admin/stats", headers: { authorization: "tma bad" } })).statusCode).toBe(401);
  });

  it("отдаёт страницу админки", async () => {
    const res = await app.inject({ url: "/admin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
