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

/**
 * Цена ликвидации для произвольной маржи (после funding или добавления маржи).
 * Позиция ликвидируется, когда маржа + PnL опускаются до MMR × объём при входе.
 */
export function liquidationPriceForMargin(
  side: Side,
  entryPrice: number,
  quantity: number,
  margin: number,
  mmr: number,
): number {
  const buffer = (margin - mmr * entryPrice * quantity) / quantity;
  return side === "long" ? entryPrice - buffer : entryPrice + buffer;
}

/** Проскальзывание рыночного ордера: больше для крупных позиций */
export function slippageRate(notional: number): number {
  return notional > 100_000 ? 0.0005 : 0.0001;
}

/**
 * Цена исполнения рыночного ордера с проскальзыванием.
 * Открытие лонга и закрытие шорта — покупка (дороже), остальное — продажа (дешевле).
 */
export function fillPrice(side: Side, action: "open" | "close", price: number, notional: number): number {
  const buying = (side === "long") === (action === "open");
  const rate = slippageRate(notional);
  return buying ? price * (1 + rate) : price * (1 - rate);
}

/** Достигла ли цена уровня отложенного ордера */
export function orderTriggered(type: "limit" | "stop", side: Side, price: number, orderPrice: number): boolean {
  const buying = side === "long";
  // Лимит покупает дешевле или продаёт дороже, стоп входит на пробое уровня
  if (type === "limit") return buying ? price <= orderPrice : price >= orderPrice;
  return buying ? price >= orderPrice : price <= orderPrice;
}

/** Верно ли выставлена цена ордера относительно рынка: иначе он исполнился бы сразу */
export function orderPriceValid(type: "limit" | "stop", side: Side, market: number, orderPrice: number): boolean {
  if (!Number.isFinite(orderPrice) || orderPrice <= 0) return false;
  return !orderTriggered(type, side, market, orderPrice);
}

/** Сработал ли Take Profit при текущей цене */
export function takeProfitHit(side: Side, price: number, takeProfit: number | null): boolean {
  if (takeProfit == null) return false;
  return side === "long" ? price >= takeProfit : price <= takeProfit;
}

/** Сработал ли Stop Loss при текущей цене */
export function stopLossHit(side: Side, price: number, stopLoss: number | null): boolean {
  if (stopLoss == null) return false;
  return side === "long" ? price <= stopLoss : price >= stopLoss;
}
