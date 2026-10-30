import type { TimeframeId } from "@financio/shared";
import { create } from "zustand";
import type { Profile } from "./api";

export type Tab = "trade" | "portfolio" | "career" | "rating" | "profile";

interface AppState {
  tab: Tab;
  symbol: string;
  tf: TimeframeId;
  name: string;
  profile: Profile;
  setTab(tab: Tab): void;
  setSymbol(symbol: string): void;
  setTf(tf: TimeframeId): void;
}

/** Стартовый профиль, пока сервер не ответил (и для игры в браузере без Telegram) */
const DEFAULT_PROFILE: Profile = { level: 1, xp: 0, xpToNext: 100, balance: 1000, minLeverage: 5, maxLeverage: 50 };

export const useApp = create<AppState>((set) => ({
  tab: "trade",
  symbol: "BTCUSDT",
  tf: "10s",
  name: "Trader",
  profile: DEFAULT_PROFILE,
  setTab: (tab) => set({ tab }),
  setSymbol: (symbol) => set({ symbol }),
  setTf: (tf) => set({ tf }),
}));
