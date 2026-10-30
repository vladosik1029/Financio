import { COINS } from "@financio/shared";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { BinanceFeed } from "./market/binance.js";
import type { PriceFeed } from "./market/feed.js";
import { MarketHub } from "./market/hub.js";
import { MockFeed } from "./market/mock.js";

const symbols = COINS.map((c) => c.symbol);
const log = (msg: string) => console.log(`[market] ${msg}`);

const feed: PriceFeed =
  config.priceFeed === "mock"
    ? new MockFeed(symbols)
    : new BinanceFeed({
        symbols,
        wsUrl: process.env.BINANCE_WS_URL,
        restUrl: process.env.BINANCE_REST_URL,
        log,
      });

const hub = new MarketHub(feed, log);
hub.start();

const app = await buildApp(hub, config.corsOrigins);
await app.listen({ port: config.port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    hub.stop();
    await app.close();
    process.exit(0);
  });
}
