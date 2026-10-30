/**
 * Достижения: разовые награды опытом за вехи карьеры.
 * Условия проверяет сервер (AchievementService), названия — в переводах achievements.<id>.
 */
export interface AchievementDef {
  id: string;
  xp: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first_trade", xp: 20 },
  { id: "first_profit", xp: 30 },
  { id: "first_liquidation", xp: 10 },
  { id: "trades_10", xp: 50 },
  { id: "trades_100", xp: 200 },
  { id: "win_streak_5", xp: 150 },
  { id: "big_win", xp: 100 },
  { id: "survivor_100x", xp: 150 },
  { id: "diversified", xp: 60 },
  { id: "tp_sniper", xp: 80 },
  { id: "full_setup", xp: 100 },
  { id: "zen", xp: 20 },
];

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Тильт: после стольких убытков подряд наставник предлагает перерыв */
export const TILT_STREAK = 3;
/** Длина перерыва; торговать в это время нельзя */
export const BREAK_MS = 10 * 60_000;
/** Награда за выдержанный перерыв */
export const BREAK_XP = 25;
export const BREAK_BONUS = 50;

export interface TiltState {
  /** Можно взять перерыв: серия убытков и сегодня перерыва ещё не было */
  eligible: boolean;
  /** До какого момента идёт перерыв, мс */
  breakUntil: number | null;
  /** Перерыв выдержан, награду можно забрать */
  claimable: boolean;
}
