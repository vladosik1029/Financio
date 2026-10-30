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

/** Что считает квест. Каждый тип сервер считает своим запросом по сделкам за сутки */
export type QuestKind =
  | "trades"
  | "profit"
  | "stopLoss"
  | "takeProfit"
  | "takeProfitHit"
  | "limitFill"
  | "coins"
  | "longShort"
  | "hold"
  | "volume"
  | "pnl";

/** Id квеста: ключ перевода quests.<id> и запись в quest_claims */
export type QuestId = string;

export interface QuestDef {
  id: QuestId;
  kind: QuestKind;
  goal: number;
  xp: number;
}

/**
 * Пул квестов дня тремя группами: сколько торговать, как торговать и какой результат.
 * Каждые сутки UTC из каждой группы выпадает по одному квесту.
 * Новый квест — строка в пуле, перевод quests.<id> и, если тип новый, подсчёт на сервере.
 */
export const QUEST_POOL: readonly (readonly QuestDef[])[] = [
  [
    { id: "trades", kind: "trades", goal: 3, xp: 30 },
    { id: "trades5", kind: "trades", goal: 5, xp: 50 },
    { id: "volume", kind: "volume", goal: 10_000, xp: 40 },
  ],
  [
    { id: "stopLoss", kind: "stopLoss", goal: 1, xp: 30 },
    { id: "takeProfit", kind: "takeProfit", goal: 1, xp: 30 },
    { id: "limitFill", kind: "limitFill", goal: 1, xp: 40 },
    { id: "coins", kind: "coins", goal: 2, xp: 35 },
    { id: "longShort", kind: "longShort", goal: 2, xp: 35 },
  ],
  [
    { id: "profit", kind: "profit", goal: 1, xp: 40 },
    { id: "profit3", kind: "profit", goal: 3, xp: 80 },
    { id: "takeProfitHit", kind: "takeProfitHit", goal: 1, xp: 50 },
    { id: "hold", kind: "hold", goal: 1, xp: 40 },
    { id: "pnl", kind: "pnl", goal: 25, xp: 60 },
  ],
];

/** Сколько держать сделку для квеста «hold» */
export const QUEST_HOLD_MS = 5 * 60_000;

/** Детерминированный генератор: у всех игроков в один день одни и те же квесты */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Квесты суток UTC, в которые попадает момент now */
export function dailyQuests(now: number): QuestDef[] {
  const rand = seeded(Math.floor(now / 86_400_000) * 2654435761);
  return QUEST_POOL.map((group) => group[Math.floor(rand() * group.length)]!);
}

export interface QuestState extends QuestDef {
  progress: number;
  done: boolean;
}

/** Начало текущих суток UTC, мс */
export function questDayStart(now: number): number {
  return Math.floor(now / 86_400_000) * 86_400_000;
}
