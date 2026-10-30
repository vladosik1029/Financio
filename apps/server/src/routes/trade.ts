import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/plugin.js";
import { TradeError, type TradingEngine } from "../trading/engine.js";

const price = z.number().positive().nullable().optional();

const openBody = z.object({
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  margin: z.number().positive(),
  leverage: z.number().int(),
  takeProfit: price,
  stopLoss: price,
});
const orderBody = openBody.extend({ type: z.enum(["limit", "stop"]), price: z.number().positive() });
const orderListQuery = z.object({
  scope: z.enum(["pending", "history"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const protectionBody = z.object({ takeProfit: price, stopLoss: price });
const marginBody = z.object({ amount: z.number().positive() });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  scope: z.enum(["open", "history"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Не больше ACTIONS_PER_WINDOW торговых действий за окно на игрока */
const ACTIONS_PER_WINDOW = 5;
const WINDOW_MS = 1000;

export async function tradeRoutes(
  app: FastifyInstance,
  opts: { engine: TradingEngine; adminIds: number[] },
): Promise<void> {
  const { engine, adminIds } = opts;
  const known = new Set<number>();
  const actions = new Map<number, number[]>();

  /** Проверяет initData и при первом запросе создаёт игрока в базе */
  const player = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireTelegramUser(req, reply);
    if (reply.sent || !req.tgUser) return;
    if (!known.has(req.tgUser.id)) {
      await engine.ensureUser(req.tgUser);
      known.add(req.tgUser.id);
    }
  };

  const limited = (userId: number): boolean => {
    const now = Date.now();
    const recent = (actions.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    actions.set(userId, recent);
    return recent.length > ACTIONS_PER_WINDOW;
  };

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await player(req, reply);
    if (!reply.sent && limited(req.tgUser!.id)) return reply.code(429).send({ error: "rate_limited" });
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TradeError) return reply.code(400).send({ error: err.code });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "bad_request" });
    app.log.error(err);
    return reply.code(500).send({ error: "internal" });
  });

  app.get("/me", { preHandler: player }, async (req) => {
    // Свежие имя и язык из Telegram сохраняем при каждом открытии MiniApp
    await engine.ensureUser(req.tgUser!);
    return {
      user: req.tgUser,
      profile: await engine.getProfile(req.tgUser!.id),
      isAdmin: adminIds.includes(req.tgUser!.id),
    };
  });

  app.get("/positions", { preHandler: player }, async (req) => {
    const q = listQuery.parse(req.query);
    return { positions: await engine.listPositions(req.tgUser!.id, q.scope, q.limit) };
  });

  app.post("/positions", { preHandler: guard }, async (req) => {
    const body = openBody.parse(req.body);
    return { position: await engine.openPosition(req.tgUser!.id, body) };
  });

  app.post("/positions/:id/close", { preHandler: guard }, async (req) => {
    const { id } = idParams.parse(req.params);
    return { position: await engine.closePosition(req.tgUser!.id, id) };
  });

  app.patch("/positions/:id", { preHandler: guard }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = protectionBody.parse(req.body);
    return {
      position: await engine.updateProtection(req.tgUser!.id, id, body.takeProfit ?? null, body.stopLoss ?? null),
    };
  });

  app.post("/positions/:id/margin", { preHandler: guard }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { amount } = marginBody.parse(req.body);
    return { position: await engine.addMargin(req.tgUser!.id, id, amount) };
  });

  app.get("/orders", { preHandler: player }, async (req) => {
    const q = orderListQuery.parse(req.query);
    return { orders: await engine.listOrders(req.tgUser!.id, q.scope, q.limit) };
  });

  app.post("/orders", { preHandler: guard }, async (req) => {
    const body = orderBody.parse(req.body);
    return { order: await engine.placeOrder(req.tgUser!.id, body) };
  });

  app.post("/orders/:id/cancel", { preHandler: guard }, async (req) => {
    const { id } = idParams.parse(req.params);
    return { order: await engine.cancelOrder(req.tgUser!.id, id) };
  });

  app.post("/loan", { preHandler: guard }, async (req) => {
    return { balance: await engine.takeLoan(req.tgUser!.id) };
  });
}
