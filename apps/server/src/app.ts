import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { MarketHub } from "./market/hub.js";
import { apiRoutes } from "./routes/api.js";
import { wsRoutes } from "./routes/ws.js";

export async function buildApp(hub: MarketHub, corsOrigins: string[]) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: corsOrigins, allowedHeaders: ["Authorization", "Content-Type"] });
  await app.register(websocket);
  await app.register(apiRoutes, { prefix: "/api", hub });
  await app.register(wsRoutes, { hub });
  return app;
}
