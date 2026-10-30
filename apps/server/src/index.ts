import { COINS } from "@financio/shared";
import { buildApp } from "./app.js";
import { UserChannels } from "./channels.js";
import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { BinanceFeed } from "./market/binance.js";
import type { PriceFeed } from "./market/feed.js";
import { MarketHub } from "./market/hub.js";
import { MockFeed } from "./market/mock.js";
import { TradingEngine } from "./trading/engine.js";
import { SettingsStore } from "./trading/settings.js";

/** Как часто проверять, не пора ли списать funding */
const FUNDING_CHECK_MS = 30_000;

const symbols = COINS.map((c) => c.symbol);
const log = (scope: string) => (msg: string) => console.log(`[${scope}] ${msg}`);

const database = await openDatabase(config.databaseUrl);
const settings = new SettingsStore(database.db);
const channels = new UserChannels();

const feed: PriceFeed =
  config.priceFeed === "mock"
    ? new MockFeed(symbols)
    : new BinanceFeed({
        symbols,
        wsUrl: process.env.BINANCE_WS_URL,
        restUrl: process.env.BINANCE_REST_URL,
        log: log("market"),
      });
const hub = new MarketHub(feed, log("market"));

const engine = new TradingEngine(database.db, hub, settings, channels.send, Date.now, log("engine"));
await engine.init();
hub.onMark((symbol, mark) => engine.onMark(symbol, mark));
hub.start();

const fundingTimer = setInterval(() => {
  engine.processFunding().catch((err) => log("engine")(`funding: ${(err as Error).message}`));
}, FUNDING_CHECK_MS);

const app = await buildApp({
  hub,
  db: database.db,
  engine,
  settings,
  channels,
  corsOrigins: config.corsOrigins,
  adminToken: config.adminToken,
  adminIds: config.adminIds,
});
await app.listen({ port: config.port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(fundingTimer);
    hub.stop();
    await app.close();
    await database.close();
    process.exit(0);
  });
}
