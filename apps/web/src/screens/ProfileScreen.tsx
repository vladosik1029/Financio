import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage } from "../i18n";
import { tg } from "../lib/telegram";

export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const user = tg?.initDataUnsafe.user;
  return (
    <div className="screen profile">
      <div className="field">
        <div className="field-head">
          <span>{t("profile.language")}</span>
        </div>
        <div className="chips">
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              className={i18n.language === lang ? "chip active" : "chip"}
              onClick={() => setLanguage(lang)}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {user && (
        <p className="muted">
          {t("profile.id")}: <span className="mono">{user.id}</span>
        </p>
      )}
      <p className="muted small">{t("profile.disclaimer")}</p>
    </div>
  );
}
