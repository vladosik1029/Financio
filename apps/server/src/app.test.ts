import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MarketHub } from "./market/hub.js";
import { MockFeed } from "./market/mock.js";

describe("API", () => {
  const hub = new MarketHub(new MockFeed(["BTCUSDT", "ETHUSDT"], 600));
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    hub.start();
    app = await buildApp(hub, []);
  });
  afterAll(async () => {
    hub.stop();
    await app.close();
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

  it("не пускает в /me без Telegram", async () => {
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
  });
});
