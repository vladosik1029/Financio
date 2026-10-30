import {
  addXp,
  dailyQuests,
  levelUpBonus,
  MIN_HOLD_FOR_XP_MS,
  QUEST_HOLD_MS,
  questDayStart,
  tradeXp,
  xpToNextLevel,
  type Position,
  type QuestId,
  type QuestKind,
  type QuestState,
} from "@financio/shared";
import { and, count, countDistinct, eq, gt, gte, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { ledger, orders, positions, questClaims, users } from "../db/schema.js";
import type { Notify } from "./engine.js";
import type { RpgService } from "./rpg.js";

/**
 * Прогрессия игрока: опыт за сделки, квесты дня и уровни.
 * Всё начисляется на сервере, клиент только показывает.
 */
export class ProgressService {
  constructor(
    private readonly db: Db,
    private readonly notify: Notify,
    private readonly now: () => number,
    private readonly rpg: RpgService,
  ) {}

  /** Квесты текущих суток UTC с прогрессом по сделкам игрока */
  async quests(userId: number): Promise<QuestState[]> {
    const now = this.now();
    const dayStart = new Date(questDayStart(now));
    const defs = dailyQuests(now);
    const values = await Promise.all(defs.map((q) => this.measure(userId, q.kind, dayStart)));
    return defs.map((q, i) => {
      const value = Math.min(values[i] ?? 0, q.goal);
      return { ...q, progress: value, done: value >= q.goal };
    });
  }

  /** Прогресс по одному типу квеста за сутки */
  private async measure(userId: number, kind: QuestKind, dayStart: Date): Promise<number> {
    const mine = eq(positions.userId, userId);
    const openedToday = and(mine, gte(positions.openedAt, dayStart));
    const closedToday = and(mine, gte(positions.closedAt, dayStart));
    // Как и опыт за сделку, квесты не засчитывают мгновенные закрытия
    const heldAtLeast = (ms: number) =>
      sql`${positions.closedAt} - ${positions.openedAt} >= ${`${ms / 1000} seconds`}::interval`;
    const n = async (where: SQL | undefined) => (await this.db.select({ n: count() }).from(positions).where(where))[0]?.n ?? 0;
    switch (kind) {
      case "trades":
        return n(openedToday);
      case "stopLoss":
        return n(and(openedToday, isNotNull(positions.stopLoss)));
      case "takeProfit":
        return n(and(openedToday, isNotNull(positions.takeProfit)));
      case "profit":
        return n(and(closedToday, gt(positions.realizedPnl, 0), heldAtLeast(MIN_HOLD_FOR_XP_MS)));
      case "takeProfitHit":
        return n(and(closedToday, eq(positions.closeReason, "take_profit")));
      case "hold":
        return n(and(closedToday, ne(positions.status, "liquidated"), heldAtLeast(QUEST_HOLD_MS)));
      case "coins": {
        const [row] = await this.db.select({ n: countDistinct(positions.symbol) }).from(positions).where(openedToday);
        return row?.n ?? 0;
      }
      case "longShort": {
        const [row] = await this.db.select({ n: countDistinct(positions.side) }).from(positions).where(openedToday);
        return row?.n ?? 0;
      }
      case "volume": {
        const [row] = await this.db
          .select({ v: sql<number>`coalesce(sum(${positions.margin} * ${positions.leverage}), 0)` })
          .from(positions)
          .where(openedToday);
        return Math.floor(Number(row?.v ?? 0));
      }
      case "pnl": {
        const [row] = await this.db
          .select({ v: sql<number>`coalesce(sum(${positions.realizedPnl}), 0)` })
          .from(positions)
          .where(closedToday);
        return Math.max(0, Math.floor(Number(row?.v ?? 0)));
      }
      case "limitFill": {
        const [row] = await this.db
          .select({ n: count() })
          .from(orders)
          .where(
            and(
              eq(orders.userId, userId),
              eq(orders.type, "limit"),
              eq(orders.status, "filled"),
              gte(orders.updatedAt, dayStart),
            ),
          );
        return row?.n ?? 0;
      }
    }
  }

  async onPositionOpened(userId: number): Promise<void> {
    await this.claimQuests(userId);
  }

  async onPositionClosed(position: Position, userId: number): Promise<void> {
    const xp = tradeXp(position);
    if (xp > 0) await this.award(userId, xp, "trade");
    await this.claimQuests(userId);
  }

  /** Выполненные, но ещё не награждённые квесты дня: награда ровно один раз */
  private async claimQuests(userId: number): Promise<void> {
    const day = questDayStart(this.now());
    for (const q of await this.quests(userId)) {
      if (!q.done) continue;
      const [claimed] = await this.db
        .insert(questClaims)
        .values({ userId, day, questId: q.id, xp: q.xp })
        .onConflictDoNothing()
        .returning();
      if (claimed) await this.award(userId, q.xp, "quest", q.id);
    }
  }

  private async award(userId: number, base: number, reason: "trade" | "quest", questId?: QuestId): Promise<void> {
    const gained = Math.round(base * (1 + (await this.rpg.effects(userId)).xpBonus));
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) return undefined;
      const next = addXp(user.level, user.xp, gained);
      let balance = user.balance;
      for (const level of next.levelsGained) {
        balance += levelUpBonus(level);
        await tx.insert(ledger).values({
          userId,
          type: "level_bonus",
          amount: levelUpBonus(level),
          balanceAfter: balance,
          note: `level ${level}`,
        });
      }
      await tx.update(users).set({ level: next.level, xp: next.xp, balance }).where(eq(users.id, userId));
      return { ...next, bonus: balance - user.balance, balance };
    });
    if (!result) return;
    this.notify(userId, {
      type: "progress",
      reason,
      questId,
      gained,
      level: result.level,
      xp: result.xp,
      xpToNext: xpToNextLevel(result.level),
      levelsGained: result.levelsGained,
      bonus: result.bonus,
    });
    if (result.bonus > 0) this.notify(userId, { type: "balance", balance: result.balance });
  }
}
