import type {
  Candle,
  Coin,
  OpenPositionRequest,
  Position,
  Profile,
  Ticker,
  Timeframe,
  TimeframeId,
} from "@financio/shared";
import { tg } from "./telegram";

/** В проде MiniApp и API живут на одном домене, локально API на :8080 */
export const API_URL = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8080" : window.location.origin)
).replace(/\/$/, "");
export const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws${tg?.initData ? `?auth=${encodeURIComponent(tg.initData)}` : ""}`;

/** Ошибка API с кодом, который переводится в i18n (errors.<code>) */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (tg?.initData) headers.Authorization = `tma ${tg.initData}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? "internal");
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);

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
  positions: (scope: "open" | "history") => get<{ positions: Position[] }>(`/positions?scope=${scope}&limit=100`),
  open: (req: OpenPositionRequest) => request<{ position: Position }>("POST", "/positions", req),
  close: (id: number) => request<{ position: Position }>("POST", `/positions/${id}/close`),
  protect: (id: number, takeProfit: number | null, stopLoss: number | null) =>
    request<{ position: Position }>("PATCH", `/positions/${id}`, { takeProfit, stopLoss }),
  addMargin: (id: number, amount: number) =>
    request<{ position: Position }>("POST", `/positions/${id}/margin`, { amount }),
  loan: () => request<{ balance: number }>("POST", "/loan"),
};
