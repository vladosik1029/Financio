import { COINS, getCoin, getTimeframe, maxLeverageForLevel, MIN_LEVERAGE, TIMEFRAMES } from "@financio/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/plugin.js";
import type { MarketHub } from "../market/hub.js";

const candlesQuery = z.object({
  symbol: z.string(),
  tf: z.string(),
  limit: z.coerce.number().int().min(1).max(1500).default(500),
});

export async function apiRoutes(app: FastifyInstance, opts: { hub: MarketHub }): Promise<void> {
  const { hub } = opts;

  app.get("/health", async () => ({ ok: true, feed: hub.feedName, stale: hub.stale }));

  app.get("/coins", async () => ({ coins: COINS, timeframes: TIMEFRAMES }));

  app.get("/tickers", async () => ({ tickers: hub.getTickers(), stale: hub.stale }));

  app.get("/candles", async (req, reply) => {
    const q = candlesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "bad_query" });
    const { symbol, tf, limit } = q.data;
    if (!getCoin(symbol)) return reply.code(404).send({ error: "unknown_symbol" });
    const timeframe = getTimeframe(tf);
    if (!timeframe) return reply.code(404).send({ error: "unknown_timeframe" });
    return { symbol, tf: timeframe.id, candles: await hub.getCandles(symbol, timeframe.id, limit) };
  });

  app.get("/me", { preHandler: requireTelegramUser }, async (req) => {
    // Прогресс игрока появится вместе с базой данных на этапе 2, пока стартовые значения
    const level = 1;
    return {
      user: req.tgUser,
      profile: {
        level,
        xp: 0,
        xpToNext: 100,
        balance: 1000,
        minLeverage: MIN_LEVERAGE,
        maxLeverage: maxLeverageForLevel(level),
      },
    };
  });
}
