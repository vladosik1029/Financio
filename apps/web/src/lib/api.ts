import type {
  Candle,
  Coin,
  GameSettings,
  OpenPositionRequest,
  Order,
  Position,
  Profile,
  RpgState,
  Leaderboard,
  LeaderboardPeriod,
  TiltState,
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
  isAdmin?: boolean;
}

export interface AdminStats {
  users: number;
  activeToday: number;
  totalBalance: number;
  openPositions: number;
  openMargin: number;
  feed: string;
  stale: boolean;
}

export interface AdminUser {
  id: number;
  firstName: string;
  username: string | null;
  balance: number;
  level: number;
  xp: number;
  banned: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface LedgerEntry {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  positionId: number | null;
  note: string | null;
  createdAt: string;
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
  orders: (scope: "pending" | "history") => get<{ orders: Order[] }>(`/orders?scope=${scope}&limit=100`),
  placeOrder: (req: OpenPositionRequest) => request<{ order: Order }>("POST", "/orders", req),
  cancelOrder: (id: number) => request<{ order: Order }>("POST", `/orders/${id}/cancel`),
  rpg: () => get<{ rpg: RpgState }>("/rpg"),
  buyItem: (id: string) => request<{ rpg: RpgState }>("POST", `/shop/${id}/buy`),
  equip: (id: string) => request<{ rpg: RpgState }>("POST", `/items/${id}/equip`),
  unequip: (id: string) => request<{ rpg: RpgState }>("POST", `/items/${id}/unequip`),
  upgradeSkill: (id: string) => request<{ rpg: RpgState }>("POST", `/skills/${id}/upgrade`),
  leaderboard: (period: LeaderboardPeriod) => get<Leaderboard>(`/leaderboard?period=${period}`),
  startBreak: () => request<{ tilt: TiltState }>("POST", "/break"),
  claimBreak: () => request<{ tilt: TiltState }>("POST", "/break/claim"),
};

/** Админка из MiniApp: сервер пускает по Telegram ID из ADMIN_TELEGRAM_IDS */
export const adminApi = {
  stats: () => get<AdminStats>("/admin/stats"),
  users: (q: string) => get<{ users: AdminUser[] }>(`/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  user: (id: number) =>
    get<{ user: AdminUser; open: Position[]; history: Position[]; ledger: LedgerEntry[] }>(`/admin/users/${id}`),
  adjustBalance: (id: number, amount: number, note: string) =>
    request<{ balance: number }>("POST", `/admin/users/${id}/balance`, { amount, note }),
  ban: (id: number, banned: boolean) => request<{ user: AdminUser }>("POST", `/admin/users/${id}/ban`, { banned }),
  closePosition: (id: number) => request<{ position: Position }>("POST", `/admin/positions/${id}/close`),
  settings: () => get<{ settings: GameSettings }>("/admin/settings"),
  saveSettings: (patch: Partial<GameSettings>) => request<{ settings: GameSettings }>("PUT", "/admin/settings", patch),
};
