import {
  addXp,
  DAILY_QUESTS,
  levelUpBonus,
  MIN_HOLD_FOR_XP_MS,
  questDayStart,
  tradeXp,
  xpToNextLevel,
  type Position,
  type QuestId,
  type QuestState,
} from "@financio/shared";
import { and, count, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { ledger, positions, questClaims, users } from "../db/schema.js";
import type { Notify } from "./engine.js";

/**
 * Прогрессия игрока: опыт за сделки, квесты дня и уровни.
 * Всё начисляется на сервере, клиент только показывает.
 */
export class ProgressService {
  constructor(
    private readonly db: Db,
    private readonly notify: Notify,
    private readonly now: () => number,
  ) {}

  /** Квесты текущих суток UTC с прогрессом по сделкам игрока */
  async quests(userId: number): Promise<QuestState[]> {
    const dayStart = new Date(questDayStart(this.now()));
    const openedToday = and(eq(positions.userId, userId), gte(positions.openedAt, dayStart));
    const [[trades], [profit], [stopLoss]] = await Promise.all([
      this.db.select({ n: count() }).from(positions).where(openedToday),
      this.db
        .select({ n: count() })
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            gte(positions.closedAt, dayStart),
            gt(positions.realizedPnl, 0),
            // Как и опыт за сделку, квест не засчитывает мгновенные закрытия
            sql`${positions.closedAt} - ${positions.openedAt} >= ${`${MIN_HOLD_FOR_XP_MS / 1000} seconds`}::interval`,
          ),
        ),
      this.db.select({ n: count() }).from(positions).where(and(openedToday, isNotNull(positions.stopLoss))),
    ]);
    const progress: Record<QuestId, number> = {
      trades: trades?.n ?? 0,
      profit: profit?.n ?? 0,
      stopLoss: stopLoss?.n ?? 0,
    };
    return DAILY_QUESTS.map((q) => {
      const value = Math.min(progress[q.id], q.goal);
      return { ...q, progress: value, done: value >= q.goal };
    });
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

  private async award(userId: number, gained: number, reason: "trade" | "quest", questId?: QuestId): Promise<void> {
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
