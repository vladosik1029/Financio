import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { telegramLanguage } from "../lib/telegram";
import { en } from "./en";
import { ru } from "./ru";

export const LANGUAGES = ["ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = "financio.lang";

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    // localStorage может быть недоступен в WebView
  }
  const tgLang = telegramLanguage() ?? navigator.language;
  return tgLang?.startsWith("ru") ? "ru" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // не критично
  }
}

export default i18n;
