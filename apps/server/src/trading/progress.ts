import {
  activeEvent,
  addXp,
  BREAK_BONUS,
  BREAK_MS,
  BREAK_XP,
  EVENT_BONUS_XP,
  EVENT_XP_MULTIPLIER,
  getAchievement,
  ITEM_SLOTS,
  TILT_STREAK,
  type RpgState,
  type ServerMessage,
  type TiltState,
  dailyQuests,
  levelUpBonus,
  MIN_HOLD_FOR_XP_MS,
  QUEST_HOLD_MS,
  questDayStart,
  tradeXp,
  xpToNextLevel,
  type Position,
  type QuestKind,
  type QuestState,
} from "@financio/shared";
import { and, count, countDistinct, desc, eq, gt, gte, isNotNull, lte, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { ledger, orders, positions, questClaims, userAchievements, users } from "../db/schema.js";
import { TradeError } from "./errors.js";
import type { Notify } from "./engine.js";
import type { RpgService } from "./rpg.js";

type ProgressReason = Extract<ServerMessage, { type: "progress" }>["reason"];

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
    // Рыночное событие на монете сделки: двойной опыт или бонус за прибыль
    const event = activeEvent(this.now());
    const onEvent = event?.symbol === position.symbol && xp > 0;
    const multiplier = onEvent && event.kind === "xpBoost" ? EVENT_XP_MULTIPLIER : 1;
    if (xp > 0) await this.award(userId, xp * multiplier, "trade");
    if (onEvent && event.kind === "bonusHunt" && (position.realizedPnl ?? 0) > 0) {
      await this.award(userId, EVENT_BONUS_XP, "event", event.id);
    }
    await this.claimQuests(userId);
    // Мгновенные закрытия достижений не открывают, как и опыта
    if ((position.closedAt ?? 0) - position.openedAt >= MIN_HOLD_FOR_XP_MS) await this.checkAchievements(userId, position);
  }

  /** Экипировка сменилась: проверяем «полное рабочее место» */
  async onRpgChanged(userId: number, state: RpgState): Promise<void> {
    if (ITEM_SLOTS.every((slot) => state.equipped[slot])) await this.unlock(userId, "full_setup");
  }

  async achievements(userId: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: userAchievements.achievementId })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return rows.map((r) => r.id);
  }

  /** Условия достижений по истории сделок; закрытия админом не считаются */
  private async checkAchievements(userId: number, last: Position): Promise<void> {
    const mine = and(eq(positions.userId, userId), isNotNull(positions.closedAt), ne(positions.closeReason, "admin"));
    const [stats] = await this.db
      .select({
        closed: count(),
        wins: sql<number>`count(*) filter (where ${positions.realizedPnl} > 0)`,
        liquidations: sql<number>`count(*) filter (where ${positions.status} = 'liquidated')`,
        takeProfits: sql<number>`count(*) filter (where ${positions.closeReason} = 'take_profit')`,
        coins: countDistinct(positions.symbol),
      })
      .from(positions)
      .where(mine);
    const recent = await this.db
      .select({ pnl: positions.realizedPnl })
      .from(positions)
      .where(mine)
      .orderBy(desc(positions.closedAt))
      .limit(5);
    const s = {
      closed: Number(stats?.closed ?? 0),
      wins: Number(stats?.wins ?? 0),
      liquidations: Number(stats?.liquidations ?? 0),
      takeProfits: Number(stats?.takeProfits ?? 0),
      coins: Number(stats?.coins ?? 0),
    };
    const held = (last.closedAt ?? 0) - last.openedAt >= MIN_HOLD_FOR_XP_MS;
    const pnl = last.realizedPnl ?? 0;
    const earned: Record<string, boolean> = {
      first_trade: s.closed >= 1,
      first_profit: s.wins >= 1,
      first_liquidation: s.liquidations >= 1,
      trades_10: s.closed >= 10,
      trades_100: s.closed >= 100,
      win_streak_5: recent.length === 5 && recent.every((r) => (r.pnl ?? 0) > 0),
      big_win: held && pnl >= last.invested,
      survivor_100x: held && pnl > 0 && last.leverage >= 100,
      diversified: s.coins >= 5,
      tp_sniper: s.takeProfits >= 10,
    };
    for (const [id, ok] of Object.entries(earned)) if (ok) await this.unlock(userId, id);
  }

  /** Выдаёт достижение один раз и начисляет его опыт */
  private async unlock(userId: number, id: string): Promise<void> {
    const def = getAchievement(id);
    if (!def) return;
    const [row] = await this.db.insert(userAchievements).values({ userId, achievementId: id }).onConflictDoNothing().returning();
    if (row) await this.award(userId, def.xp, "achievement", id);
  }

  // ---------- Тильт и перерыв ----------

  async tilt(userId: number): Promise<TiltState> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) return { eligible: false, breakUntil: null, claimable: false };
    const now = this.now();
    const until = user.breakUntil?.getTime() ?? null;
    const onBreak = until !== null && until > now;
    const claimable = until !== null && !user.breakClaimed && until <= now;
    // Перерыв раз в сутки UTC: считаем по моменту его начала
    const tookToday = until !== null && questDayStart(until - BREAK_MS) === questDayStart(now);
    let eligible = false;
    if (!onBreak && !claimable && !tookToday) {
      const recent = await this.db
        .select({ pnl: positions.realizedPnl })
        .from(positions)
        .where(and(eq(positions.userId, userId), isNotNull(positions.closedAt), ne(positions.closeReason, "admin")))
        .orderBy(desc(positions.closedAt))
        .limit(TILT_STREAK);
      eligible = recent.length === TILT_STREAK && recent.every((r) => (r.pnl ?? 0) < 0);
    }
    return { eligible, breakUntil: onBreak ? until : null, claimable };
  }

  async startBreak(userId: number): Promise<TiltState> {
    if (!(await this.tilt(userId)).eligible) throw new TradeError("break_unavailable");
    await this.db
      .update(users)
      .set({ breakUntil: new Date(this.now() + BREAK_MS), breakClaimed: false })
      .where(eq(users.id, userId));
    return this.tilt(userId);
  }

  async claimBreak(userId: number): Promise<TiltState> {
    const [row] = await this.db
      .update(users)
      .set({ breakClaimed: true })
      .where(and(eq(users.id, userId), eq(users.breakClaimed, false), lte(users.breakUntil, new Date(this.now()))))
      .returning();
    if (!row) throw new TradeError("break_not_over");
    await this.award(userId, BREAK_XP, "break", undefined, BREAK_BONUS);
    await this.unlock(userId, "zen");
    return this.tilt(userId);
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

  /** Начисляет опыт (с бонусом экипировки) и, если задано, деньги на баланс */
  private async award(userId: number, base: number, reason: ProgressReason, ref?: string, cash = 0): Promise<void> {
    const gained = Math.round(base * (1 + (await this.rpg.effects(userId)).xpBonus));
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) return undefined;
      const next = addXp(user.level, user.xp, gained);
      let balance = user.balance;
      if (cash > 0) {
        balance += cash;
        await tx.insert(ledger).values({ userId, type: "break_bonus", amount: cash, balanceAfter: balance });
      }
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
      ref,
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
