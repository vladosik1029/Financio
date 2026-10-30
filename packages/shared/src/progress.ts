import type { Position } from "./types.js";

/** Опыт до следующего уровня: уровень × 100 */
export function xpToNextLevel(level: number): number {
  return level * 100;
}

/** Бонус на баланс за новый уровень, $ */
export function levelUpBonus(level: number): number {
  return level * 50;
}

/** Сделки короче этого не дают опыта: защита от накрутки открытием-закрытием */
export const MIN_HOLD_FOR_XP_MS = 15_000;

/**
 * Опыт за закрытую сделку. Любая сделка учит (5 XP), прибыльная даёт +10
 * и ещё до +35 за доходность на маржу (+1 за каждые 2%), ликвидация — 1 XP «за урок».
 */
export function tradeXp(p: Pick<Position, "openedAt" | "closedAt" | "realizedPnl" | "invested" | "closeReason">): number {
  if (!p.closedAt || p.closedAt - p.openedAt < MIN_HOLD_FOR_XP_MS) return 0;
  if (p.closeReason === "admin") return 0;
  if (p.closeReason === "liquidation") return 1;
  const pnl = p.realizedPnl ?? 0;
  if (pnl <= 0) return 5;
  const roePct = (pnl / p.invested) * 100;
  return 15 + Math.min(35, Math.floor(roePct / 2));
}

/** Начисляет опыт и поднимает уровень, опыт внутри уровня копится с нуля */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number; levelsGained: number[] } {
  const levelsGained: number[] = [];
  xp += gained;
  while (xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level++;
    levelsGained.push(level);
  }
  return { level, xp, levelsGained };
}

export type QuestId = "trades" | "profit" | "stopLoss";

export interface QuestDef {
  id: QuestId;
  goal: number;
  xp: number;
}

/** Квесты дня: обновляются в полночь UTC, опыт начисляется сразу при выполнении */
export const DAILY_QUESTS: readonly QuestDef[] = [
  { id: "trades", goal: 3, xp: 30 },
  { id: "profit", goal: 1, xp: 40 },
  { id: "stopLoss", goal: 1, xp: 30 },
];

export interface QuestState extends QuestDef {
  progress: number;
  done: boolean;
}

/** Начало текущих суток UTC, мс */
export function questDayStart(now: number): number {
  return Math.floor(now / 86_400_000) * 86_400_000;
}
