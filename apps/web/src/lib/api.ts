import type { Candle, Coin, Ticker, Timeframe, TimeframeId } from "@financio/shared";
import { tg } from "./telegram";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
export const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws`;

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (tg?.initData) headers.Authorization = `tma ${tg.initData}`;
  const res = await fetch(`${API_URL}/api${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Profile {
  level: number;
  xp: number;
  xpToNext: number;
  balance: number;
  minLeverage: number;
  maxLeverage: number;
}

export interface Me {
  user: { id: number; first_name: string; username?: string; language_code?: string };
  profile: Profile;
}

export const api = {
  coins: () => get<{ coins: Coin[]; timeframes: Timeframe[] }>("/coins"),
  tickers: () => get<{ tickers: Ticker[]; stale: boolean }>("/tickers"),
  candles: (symbol: string, tf: TimeframeId, limit = 500) =>
    get<{ candles: Candle[] }>(`/candles?symbol=${symbol}&tf=${tf}&limit=${limit}`),
  me: () => get<Me>("/me"),
};
