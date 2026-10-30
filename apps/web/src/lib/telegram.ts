import { theme } from "./theme";

/** Минимальные типы Telegram WebApp, которые использует игра */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; username?: string; language_code?: string } };
  version: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  isVersionAtLeast(version: string): boolean;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined = window.Telegram?.WebApp?.initData
  ? window.Telegram.WebApp
  : undefined;

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes?.();
  if (tg.isVersionAtLeast("6.1")) {
    tg.setHeaderColor?.(theme.bg);
    tg.setBackgroundColor?.(theme.bg);
  }
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.selectionChanged(),
  impact: () => tg?.HapticFeedback?.impactOccurred("medium"),
  success: () => tg?.HapticFeedback?.notificationOccurred("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred("warning"),
  error: () => tg?.HapticFeedback?.notificationOccurred("error"),
};

export function telegramLanguage(): string | undefined {
  return tg?.initDataUnsafe.user?.language_code;
}
