import { NO_EFFECTS, type Order, type OrderEvent, type Position, type Profile, type RpgState, type ServerMessage, type TimeframeId } from "@financio/shared";
import { create } from "zustand";
import { api } from "./api";

export type Tab = "home" | "trade" | "portfolio" | "career" | "profile" | "admin";

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
  isAdmin: boolean;
  profile: Profile;
  open: Position[];
  history: Position[];
  /** Отложенные ордера (лимит и стоп), ждущие исполнения */
  orders: Order[];
  alert: Alert | null;
  /** Короткое уведомление внизу экрана: исполнение или отклонение ордера */
  toast: Toast | null;
  /** Только что взятый уровень: показываем поздравление */
  levelUp: { level: number; bonus: number } | null;
  setTab(tab: Tab): void;
  setSymbol(symbol: string): void;
  setTf(tf: TimeframeId): void;
  refresh(): Promise<void>;
  refreshHistory(): Promise<void>;
  applyPosition(event: "opened" | "updated" | "closed", position: Position): void;
  applyOrder(event: OrderEvent, order: Order): void;
  showToast(toast: Toast): void;
  applyProgress(msg: Extract<ServerMessage, { type: "progress" }>): void;
  dismissLevelUp(): void;
  setBalance(balance: number): void;
  /** Экипировка и навыки сменились: бонусы меняют и лимиты профиля */
  applyRpg(rpg: RpgState): void;
  dismissAlert(): void;
}

export interface Toast {
  /** Ключ перевода и параметры */
  key: string;
  params?: Record<string, string | number>;
  error?: boolean;
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
  quests: [],
  rpg: { owned: [], equipped: {}, skills: {}, skillPoints: 0, effects: { ...NO_EFFECTS } },
};

export const useApp = create<AppState>((set, get) => ({
  tab: "home",
  symbol: "BTCUSDT",
  tf: "10s",
  name: "Trader",
  online: false,
  isAdmin: false,
  profile: DEFAULT_PROFILE,
  open: [],
  history: [],
  orders: [],
  alert: null,
  toast: null,
  levelUp: null,
  setTab: (tab) => set({ tab }),
  setSymbol: (symbol) => set({ symbol }),
  setTf: (tf) => set({ tf }),

  async refresh() {
    try {
      const [me, open, orders] = await Promise.all([api.me(), api.positions("open"), api.orders("pending")]);
      set({
        name: me.user.first_name,
        profile: me.profile,
        isAdmin: me.isAdmin ?? false,
        open: open.positions,
        orders: orders.orders,
        online: true,
      });
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

  applyOrder(event, order) {
    const rest = get().orders.filter((o) => o.id !== order.id);
    set({ orders: event === "placed" ? [order, ...rest] : rest });
  },

  showToast(toast) {
    set({ toast });
    setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 3500);
  },

  applyProgress(msg) {
    set({ profile: { ...get().profile, level: msg.level, xp: msg.xp, xpToNext: msg.xpToNext } });
    get().showToast({
      key: msg.reason === "quest" ? "progress.quest" : "progress.trade",
      params: { xp: msg.gained, quest: msg.questId ?? "" },
    });
    const level = msg.levelsGained[msg.levelsGained.length - 1];
    if (level) set({ levelUp: { level, bonus: msg.bonus } });
    // Новые квесты, плечо и монеты приходят с профилем
    void api.me().then((me) => set({ profile: me.profile })).catch(() => {});
  },

  dismissLevelUp: () => set({ levelUp: null }),

  setBalance: (balance) => set({ profile: { ...get().profile, balance } }),
  applyRpg(rpg) {
    set({ profile: { ...get().profile, rpg } });
    void api.me().then((me) => set({ profile: me.profile })).catch(() => {});
  },
  dismissAlert: () => set({ alert: null }),
}));
