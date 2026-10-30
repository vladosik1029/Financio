import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { UserChannels } from "./channels.js";
import type { Db } from "./db/index.js";
import type { MarketHub } from "./market/hub.js";
import { adminPage, adminRoutes } from "./routes/admin.js";
import { apiRoutes } from "./routes/api.js";
import { tradeRoutes } from "./routes/trade.js";
import { wsRoutes } from "./routes/ws.js";
import type { TradingEngine } from "./trading/engine.js";
import type { SettingsStore } from "./trading/settings.js";

export interface AppDeps {
  hub: MarketHub;
  db: Db;
  engine: TradingEngine;
  settings: SettingsStore;
  channels: UserChannels;
  corsOrigins: string[];
  adminToken: string;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  await app.register(cors, {
    origin: deps.corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(websocket);
  await app.register(apiRoutes, { prefix: "/api", hub: deps.hub });
  await app.register(tradeRoutes, { prefix: "/api", engine: deps.engine });
  await app.register(adminRoutes, {
    prefix: "/api/admin",
    db: deps.db,
    engine: deps.engine,
    settings: deps.settings,
    hub: deps.hub,
    token: deps.adminToken,
  });
  await app.register(adminPage, { enabled: !!deps.adminToken });
  await app.register(wsRoutes, { hub: deps.hub, channels: deps.channels });
  return app;
}
