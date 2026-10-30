import type { Position, Profile, TimeframeId } from "@financio/shared";
import { create } from "zustand";
import { api } from "./api";

export type Tab = "trade" | "portfolio" | "career" | "rating" | "profile";

/** Событие, которое показываем поверх экрана: ликвидация, TP или SL */
export interface Alert {
  position: Position;
}

interface AppState {
  tab: Tab;
  symbol: string;
  tf: TimeframeId;
  name: string;
  /** Есть ли связь с игровым сервером (без неё работает только просмотр графика) */
  online: boolean;
  profile: Profile;
  open: Position[];
  history: Position[];
  alert: Alert | null;
  setTab(tab: Tab): void;
  setSymbol(symbol: string): void;
  setTf(tf: TimeframeId): void;
  refresh(): Promise<void>;
  refreshHistory(): Promise<void>;
  applyPosition(event: "opened" | "updated" | "closed", position: Position): void;
  setBalance(balance: number): void;
  dismissAlert(): void;
}

/** Стартовый профиль, пока сервер не ответил */
const DEFAULT_PROFILE: Profile = {
  level: 1,
  xp: 0,
  xpToNext: 100,
  balance: 1000,
  minLeverage: 5,
  maxLeverage: 50,
  maxOpenPositions: 10,
  takerFeeRate: 0.0005,
  canTakeLoan: false,
  loanAmount: 500,
};

export const useApp = create<AppState>((set, get) => ({
  tab: "trade",
  symbol: "BTCUSDT",
  tf: "10s",
  name: "Trader",
  online: false,
  profile: DEFAULT_PROFILE,
  open: [],
  history: [],
  alert: null,
  setTab: (tab) => set({ tab }),
  setSymbol: (symbol) => set({ symbol }),
  setTf: (tf) => set({ tf }),

  async refresh() {
    try {
      const [me, open] = await Promise.all([api.me(), api.positions("open")]);
      set({ name: me.user.first_name, profile: me.profile, open: open.positions, online: true });
    } catch {
      set({ online: false });
    }
  },

  async refreshHistory() {
    try {
      const { positions } = await api.positions("history");
      set({ history: positions });
    } catch {
      // история не критична
    }
  },

  applyPosition(event, position) {
    const open = get().open.filter((p) => p.id !== position.id);
    if (event === "closed") {
      set({ open, history: [position, ...get().history.filter((p) => p.id !== position.id)] });
      if (position.closeReason && position.closeReason !== "manual") set({ alert: { position } });
      // После закрытия мог стать доступен кредит наставника
      void api.me().then((me) => set({ profile: me.profile })).catch(() => {});
    } else {
      set({ open: [position, ...open].sort((a, b) => b.openedAt - a.openedAt) });
    }
  },

  setBalance: (balance) => set({ profile: { ...get().profile, balance } }),
  dismissAlert: () => set({ alert: null }),
}));
