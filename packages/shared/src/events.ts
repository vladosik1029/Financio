import { COINS } from "./coins.js";

/**
 * Рыночные события от NPC. Реальные цены игра не двигает, поэтому событие
 * меняет правила игры на одной монете: больше опыта, ниже комиссия или
 * бонус за прибыльную сделку. Расписание одно на всех и считается от времени.
 */
export type MarketEventKind = "xpBoost" | "feeHoliday" | "bonusHunt";

export interface MarketEventDef {
  id: string;
  kind: MarketEventKind;
  /** Монеты, на которых может случиться событие */
  coins: readonly string[];
}

const MAJORS = ["BTCUSDT", "ETHUSDT"];

export const MARKET_EVENTS: readonly MarketEventDef[] = [
  { id: "elon_tweet", kind: "xpBoost", coins: ["DOGEUSDT", ...MAJORS] },
  { id: "halving_hype", kind: "xpBoost", coins: ["BTCUSDT"] },
  { id: "regulator_sleeps", kind: "feeHoliday", coins: MAJORS },
  { id: "exchange_promo", kind: "feeHoliday", coins: COINS.map((c) => c.symbol) },
  { id: "whale_alert", kind: "bonusHunt", coins: MAJORS },
  { id: "short_squeeze", kind: "bonusHunt", coins: ["ETHUSDT", "SOLUSDT", "TONUSDT"] },
];

/** Одно событие на каждые 3 часа, длится 30 минут */
export const EVENT_SLOT_MS = 3 * 3600_000;
export const EVENT_DURATION_MS = 30 * 60_000;
/** Множитель опыта при xpBoost, скидка на комиссию при feeHoliday, бонус при bonusHunt */
export const EVENT_XP_MULTIPLIER = 2;
export const EVENT_FEE_DISCOUNT = 0.5;
export const EVENT_BONUS_XP = 30;

export interface MarketEvent {
  id: string;
  kind: MarketEventKind;
  symbol: string;
  startsAt: number;
  endsAt: number;
}

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Событие слота: начинается в случайный момент первых 2,5 часов слота */
export function eventForSlot(slot: number): MarketEvent {
  const h = hash(slot);
  const def = MARKET_EVENTS[h % MARKET_EVENTS.length]!;
  const symbol = def.coins[(h >>> 8) % def.coins.length]!;
  const offset = ((h >>> 16) % 5) * EVENT_DURATION_MS;
  const startsAt = slot * EVENT_SLOT_MS + offset;
  return { id: def.id, kind: def.kind, symbol, startsAt, endsAt: startsAt + EVENT_DURATION_MS };
}

/** Идущее сейчас событие или null */
export function activeEvent(now: number): MarketEvent | null {
  const e = eventForSlot(Math.floor(now / EVENT_SLOT_MS));
  return now >= e.startsAt && now < e.endsAt ? e : null;
}

/** Идущее или ближайшее событие: для баннера с обратным отсчётом */
export function currentOrNextEvent(now: number): MarketEvent {
  const slot = Math.floor(now / EVENT_SLOT_MS);
  const e = eventForSlot(slot);
  return now < e.endsAt ? e : eventForSlot(slot + 1);
}

/** Множитель комиссии по монете с учётом события */
export function eventFeeMultiplier(symbol: string, now: number): number {
  const e = activeEvent(now);
  return e && e.kind === "feeHoliday" && e.symbol === symbol ? 1 - EVENT_FEE_DISCOUNT : 1;
}
