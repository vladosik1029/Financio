import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, count, desc, eq, ilike, or, sql, sum } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { ledger, positions, users } from "../db/schema.js";
import type { MarketHub } from "../market/hub.js";
import { TradeError, type TradingEngine } from "../trading/engine.js";
import { toPosition } from "../trading/mappers.js";
import { settingsSchema, type SettingsStore } from "../trading/settings.js";

const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../admin/index.html");

interface AdminDeps {
  db: Db;
  engine: TradingEngine;
  settings: SettingsStore;
  hub: MarketHub;
  token: string;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Страница админки: /admin */
export async function adminPage(app: FastifyInstance, opts: { enabled: boolean }): Promise<void> {
  app.get("/admin", async (_req, reply) => {
    if (!opts.enabled) return reply.code(404).send({ error: "admin_disabled" });
    return reply.type("text/html; charset=utf-8").send(await readFile(pagePath, "utf8"));
  });
}

/** API админки: /api/admin/*, доступ по `Authorization: Bearer <ADMIN_TOKEN>` */
export async function adminRoutes(app: FastifyInstance, opts: AdminDeps): Promise<void> {
  const { db, engine, settings, hub, token } = opts;

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!token) return reply.code(404).send({ error: "admin_disabled" });
    const given = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!tokenMatches(given, token)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TradeError) return reply.code(400).send({ error: err.code });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "bad_request", issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: "internal" });
  });

  app.get("/stats", async () => {
    const [u] = await db.select({ n: count(), total: sum(users.balance) }).from(users);
    const [open] = await db
      .select({ n: count(), margin: sum(positions.margin) })
      .from(positions)
      .where(eq(positions.status, "open"));
    const [day] = await db
      .select({ n: count() })
      .from(users)
      .where(sql`${users.lastSeenAt} > now() - interval '1 day'`);
    return {
      users: u?.n ?? 0,
      activeToday: day?.n ?? 0,
      totalBalance: Number(u?.total ?? 0),
      openPositions: open?.n ?? 0,
      openMargin: Number(open?.margin ?? 0),
      feed: hub.feedName,
      stale: hub.stale,
    };
  });

  app.get("/users", async (req) => {
    const q = z
      .object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    const term = q.q?.trim();
    const where = term
      ? or(
          ilike(users.firstName, `%${term}%`),
          ilike(users.username, `%${term}%`),
          /^\d+$/.test(term) ? eq(users.id, Number(term)) : undefined,
        )
      : undefined;
    const rows = await db.select().from(users).where(where).orderBy(desc(users.lastSeenAt)).limit(q.limit);
    return { users: rows };
  });

  app.get("/users/:id", async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return reply.code(404).send({ error: "not_found" });
    const open = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, id), eq(positions.status, "open")))
      .orderBy(desc(positions.openedAt));
    const history = await engine.listPositions(id, "history", 30);
    const entries = await db
      .select()
      .from(ledger)
      .where(eq(ledger.userId, id))
      .orderBy(desc(ledger.id))
      .limit(50);
    return { user, open: open.map(toPosition), history, ledger: entries };
  });

  app.post("/users/:id/balance", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const body = z.object({ amount: z.number().refine((n) => n !== 0), note: z.string().min(1).max(200) }).parse(req.body);
    return { balance: await engine.adminAdjustBalance(id, body.amount, body.note) };
  });

  app.post("/users/:id/ban", async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const { banned } = z.object({ banned: z.boolean() }).parse(req.body);
    const [row] = await db.update(users).set({ banned }).where(eq(users.id, id)).returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return { user: row };
  });

  app.post("/positions/:id/close", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    return { position: await engine.adminClosePosition(id) };
  });

  app.get("/settings", async () => ({ settings: settings.get() }));

  app.put("/settings", async (req) => {
    const patch = settingsSchema.partial().parse(req.body);
    return { settings: await settings.update(patch) };
  });
}
