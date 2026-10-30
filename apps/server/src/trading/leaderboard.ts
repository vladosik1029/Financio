import { questDayStart, type Leaderboard, type LeaderboardPeriod, type LeaderboardRow } from "@financio/shared";
import { and, desc, eq, gte, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { positions, users } from "../db/schema.js";

const TOP = 50;
const CACHE_MS = 30_000;

/** Начало недели UTC (понедельник) */
export function weekStart(now: number): number {
  const day = questDayStart(now);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * 86_400_000;
}

/**
 * Рейтинг по реализованному PnL за сутки, неделю или всё время.
 * Топ кешируется на 30 секунд, строка игрока считается отдельно.
 */
export class LeaderboardService {
  private readonly cache = new Map<LeaderboardPeriod, { at: number; rows: LeaderboardRow[] }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  async get(period: LeaderboardPeriod, userId: number): Promise<Leaderboard> {
    const rows = await this.top(period);
    const me = rows.find((r) => r.userId === userId) ?? (await this.rankOf(period, userId));
    return { period, rows, me };
  }

  private where(period: LeaderboardPeriod): SQL | undefined {
    const now = this.now();
    const since = period === "day" ? questDayStart(now) : period === "week" ? weekStart(now) : null;
    return and(
      isNotNull(positions.closedAt),
      ne(positions.closeReason, "admin"),
      eq(users.banned, false),
      since === null ? undefined : gte(positions.closedAt, new Date(since)),
    );
  }

  private pnl = sql<number>`sum(${positions.realizedPnl})`;

  private async top(period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
    const cached = this.cache.get(period);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.rows;
    const rows = await this.db
      .select({
        userId: users.id,
        name: users.firstName,
        level: users.level,
        pnl: this.pnl,
        trades: sql<number>`count(*)`,
      })
      .from(positions)
      .innerJoin(users, eq(users.id, positions.userId))
      .where(this.where(period))
      .groupBy(users.id)
      .orderBy(desc(this.pnl))
      .limit(TOP);
    const result = rows.map((r, i) => ({ ...r, pnl: Number(r.pnl), trades: Number(r.trades), rank: i + 1 }));
    this.cache.set(period, { at: this.now(), rows: result });
    return result;
  }

  /** Место игрока вне топа: сколько игроков заработали больше него, плюс один */
  private async rankOf(period: LeaderboardPeriod, userId: number): Promise<LeaderboardRow | null> {
    const [mine] = await this.db
      .select({ name: users.firstName, level: users.level, pnl: this.pnl, trades: sql<number>`count(*)` })
      .from(positions)
      .innerJoin(users, eq(users.id, positions.userId))
      .where(and(this.where(period), eq(users.id, userId)))
      .groupBy(users.id);
    if (!mine) return null;
    const better = this.db
      .select({ id: users.id })
      .from(positions)
      .innerJoin(users, eq(users.id, positions.userId))
      .where(this.where(period))
      .groupBy(users.id)
      .having(sql`${this.pnl} > ${Number(mine.pnl)}`)
      .as("better");
    const [ahead] = await this.db.select({ n: sql<number>`count(*)` }).from(better);
    return {
      rank: Number(ahead?.n ?? 0) + 1,
      userId,
      name: mine.name,
      level: mine.level,
      pnl: Number(mine.pnl),
      trades: Number(mine.trades),
    };
  }
}
