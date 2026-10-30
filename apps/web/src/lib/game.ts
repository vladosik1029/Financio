import { unrealizedPnl, type Position, type Ticker } from "@financio/shared";

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

export interface Quest {
  id: "trades" | "profit" | "stopLoss";
  progress: number;
  goal: number;
}

/**
 * Квесты дня считаются по сделкам за сегодня. Награды опытом начислит сервер,
 * когда появятся уровни (этап 3), пока это только прогресс.
 */
export function dailyQuests(open: Position[], history: Position[], now = Date.now()): Quest[] {
  const today = startOfToday(now);
  const openedToday = [...open, ...history].filter((p) => p.openedAt >= today);
  const closedToday = history.filter((p) => (p.closedAt ?? 0) >= today);
  return [
    { id: "trades", progress: Math.min(openedToday.length, 3), goal: 3 },
    { id: "profit", progress: closedToday.some((p) => (p.realizedPnl ?? 0) > 0) ? 1 : 0, goal: 1 },
    { id: "stopLoss", progress: openedToday.some((p) => p.stopLoss != null) ? 1 : 0, goal: 1 },
  ];
}
