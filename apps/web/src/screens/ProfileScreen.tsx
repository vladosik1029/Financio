import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage } from "../i18n";
import { tg } from "../lib/telegram";

export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const user = tg?.initDataUnsafe.user;
  return (
    <div className="screen profile">
      <section className="card admin-form">
        <div className="admin-field">
          <span>{t("profile.language")}</span>
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
          <div className="admin-field">
            <span>{t("profile.id")}</span>
            <span className="mono">{user.id}</span>
          </div>
        )}
      </section>
      <p className="muted small">{t("profile.disclaimer")}</p>
    </div>
  );
}
