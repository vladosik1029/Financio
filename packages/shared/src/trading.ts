import type { Side } from "./types.js";

export const MIN_LEVERAGE = 5;
export const MAX_LEVERAGE = 150;

/** Комиссия за исполнение по рынку (taker), доля от объёма позиции */
export const TAKER_FEE_RATE = 0.0005;
/** Комиссия за лимитный ордер (maker), доля от объёма позиции */
export const MAKER_FEE_RATE = 0.0002;

/** Интервал списания funding, мс (8 часов) */
export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

/**
 * Максимальное плечо по уровню игрока:
 * уровни 1–9 — до 50x, 10–19 — до 100x, с 20-го — до 150x.
 */
export function maxLeverageForLevel(level: number): number {
  if (level >= 20) return 150;
  if (level >= 10) return 100;
  return 50;
}

/**
 * Поддерживающая маржа (MMR). Выше 100x она ниже, иначе позиция
 * ликвидировалась бы почти сразу после открытия.
 */
export function maintenanceMarginRate(leverage: number): number {
  return leverage > 100 ? 0.003 : 0.005;
}

export interface LeverageCheck {
  ok: boolean;
  reason?: "not_integer" | "too_low" | "too_high_for_level";
}

export function checkLeverage(leverage: number, level: number): LeverageCheck {
  if (!Number.isInteger(leverage)) return { ok: false, reason: "not_integer" };
  if (leverage < MIN_LEVERAGE) return { ok: false, reason: "too_low" };
  if (leverage > maxLeverageForLevel(level)) return { ok: false, reason: "too_high_for_level" };
  return { ok: true };
}

/** Объём позиции в $: маржа × плечо */
export function positionNotional(margin: number, leverage: number): number {
  return margin * leverage;
}

/** Количество монет в позиции */
export function positionQuantity(margin: number, leverage: number, entryPrice: number): number {
  return positionNotional(margin, leverage) / entryPrice;
}

/**
 * Цена ликвидации изолированной позиции.
 * Long:  entry × (1 − 1/L + MMR)
 * Short: entry × (1 + 1/L − MMR)
 */
export function liquidationPrice(
  side: Side,
  entryPrice: number,
  leverage: number,
  mmr: number = maintenanceMarginRate(leverage),
): number {
  const k = 1 / leverage;
  return side === "long" ? entryPrice * (1 - k + mmr) : entryPrice * (1 + k - mmr);
}

export function isLiquidated(side: Side, markPrice: number, liqPrice: number): boolean {
  return side === "long" ? markPrice <= liqPrice : markPrice >= liqPrice;
}

/** Нереализованный PnL в $ */
export function unrealizedPnl(
  side: Side,
  entryPrice: number,
  markPrice: number,
  quantity: number,
): number {
  const diff = markPrice - entryPrice;
  return (side === "long" ? diff : -diff) * quantity;
}

/** ROE: PnL относительно маржи, доля (0.25 = +25%) */
export function returnOnEquity(pnl: number, margin: number): number {
  return margin === 0 ? 0 : pnl / margin;
}

export function tradingFee(notional: number, rate: number = TAKER_FEE_RATE): number {
  return notional * rate;
}

/**
 * Платёж funding для позиции, $. Положительный — игрок получает,
 * отрицательный — платит. При положительной ставке лонги платят шортам.
 */
export function fundingPayment(side: Side, notional: number, fundingRate: number): number {
  const amount = notional * fundingRate;
  return side === "long" ? -amount : amount;
}
