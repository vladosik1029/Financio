import { BREAK_BONUS, BREAK_XP, maxLeverageForLevel, unrealizedPnl, type EffectKey, type Effects, type Position, type Profile, type Ticker } from "@financio/shared";

/** Ранг трейдера по уровню: ключ перевода ranks.* */
export function rankKey(level: number): string {
  if (level >= 30) return "whale";
  if (level >= 20) return "senior";
  if (level >= 10) return "trader";
  if (level >= 5) return "junior";
  return "intern";
}

export interface AccountSummary {
  /** Баланс плюс маржа и нереализованный PnL открытых позиций */
  equity: number;
  inPositions: number;
  unrealized: number;
}

export function accountSummary(balance: number, open: Position[], tickers: Record<string, Ticker>): AccountSummary {
  let inPositions = 0;
  let unrealized = 0;
  for (const p of open) {
    const mark = tickers[p.symbol]?.mark ?? p.entryPrice;
    inPositions += p.margin;
    unrealized += unrealizedPnl(p.side, p.entryPrice, mark, p.quantity);
  }
  return { equity: balance + inPositions + unrealized, inPositions, unrealized };
}

export function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface TradeStats {
  todayPnl: number;
  todayTrades: number;
  total: number;
  winRate: number | null;
  best: number | null;
}

export function tradeStats(history: Position[], now = Date.now()): TradeStats {
  const today = startOfToday(now);
  const closedToday = history.filter((p) => (p.closedAt ?? 0) >= today);
  const wins = history.filter((p) => (p.realizedPnl ?? 0) > 0).length;
  return {
    todayPnl: closedToday.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0),
    todayTrades: closedToday.length,
    total: history.length,
    winRate: history.length ? wins / history.length : null,
    best: history.length ? Math.max(...history.map((p) => p.realizedPnl ?? 0)) : null,
  };
}

/** Сколько последних закрытых сделок подряд ушли в минус */
export function lossStreak(history: Position[]): number {
  let n = 0;
  for (const p of history) {
    if ((p.realizedPnl ?? 0) >= 0) break;
    n++;
  }
  return n;
}

export interface MentorTip {
  /** Ключ перевода mentor.* */
  key: string;
  params?: Record<string, string | number>;
  /** warn — предупреждение (тильт, ликвидация), tip — совет */
  tone: "warn" | "tip";
  /** Кнопка под репликой: начать перерыв или забрать награду за него */
  action?: "break" | "claim";
}

const GENERAL_TIPS = ["riskPerTrade", "trend", "limitOrders", "funding", "patience"];

/**
 * Наставник смотрит на состояние игрока и выбирает одну самую важную реплику.
 * Порядок — от срочного к общему.
 */
export function mentorTip(profile: Profile, open: Position[], history: Position[], now = Date.now()): MentorTip {
  if (profile.canTakeLoan) return { key: "loan", params: { amount: profile.loanAmount }, tone: "warn" };
  const last = history[0];
  if (last?.closeReason === "liquidation" && now - (last.closedAt ?? 0) < 3600_000) {
    return { key: "afterLiquidation", params: { lev: last.leverage }, tone: "warn" };
  }
  if (profile.tilt.claimable) return { key: "breakDone", params: { xp: BREAK_XP, amount: BREAK_BONUS }, tone: "tip", action: "claim" };
  if (profile.tilt.breakUntil) return { key: "onBreak", tone: "tip" };
  const streak = lossStreak(history);
  if (profile.tilt.eligible) {
    return { key: "tiltBreak", params: { n: streak, xp: BREAK_XP, amount: BREAK_BONUS }, tone: "warn", action: "break" };
  }
  if (streak >= 3) return { key: "tilt", params: { n: streak }, tone: "warn" };
  if (history.length === 0 && open.length === 0) return { key: "welcome", tone: "tip" };
  const unprotected = open.filter((p) => p.stopLoss == null);
  if (unprotected.length > 0) return { key: "noStopLoss", params: { n: unprotected.length }, tone: "warn" };
  if (open.some((p) => p.leverage >= 50)) return { key: "highLeverage", tone: "warn" };
  const quest = profile.quests.find((q) => !q.done);
  if (quest) return { key: "quest", params: { quest: quest.id, xp: quest.xp }, tone: "tip" };
  // Ближайший уровень, на котором вырастет максимальное плечо
  const max = maxLeverageForLevel(profile.level);
  let next = profile.level + 1;
  while (next <= 100 && maxLeverageForLevel(next) === max) next++;
  if (next <= 100) return { key: "nextUnlock", params: { lev: maxLeverageForLevel(next), level: next }, tone: "tip" };
  const day = Math.floor(now / 86_400_000);
  return { key: `tips.${GENERAL_TIPS[day % GENERAL_TIPS.length]}`, tone: "tip" };
}

/** Сколько осталось до обновления квестов (полночь UTC), чч:мм */
export function untilQuestReset(now = Date.now()): string {
  const left = 86_400_000 - (now % 86_400_000);
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Эффекты вещи или навыка строками перевода effects.*: доли переводим в проценты */
export function effectLines(effects: Partial<Effects>, times = 1): { key: string; v: number }[] {
  return (Object.keys(effects) as EffectKey[])
    .filter((k) => (effects[k] ?? 0) > 0)
    .map((k) => {
      const value = (effects[k] ?? 0) * times;
      return { key: `effects.${k}`, v: k === "extraPositions" ? value : Math.round(value * 100) };
    });
}
