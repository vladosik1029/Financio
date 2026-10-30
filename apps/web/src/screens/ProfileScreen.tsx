import { useTranslation } from "react-i18next";
import { TraderScene } from "../components/TraderScene";
import { LANGUAGES, setLanguage } from "../i18n";
import { rankKey } from "../lib/game";
import { useApp } from "../lib/store";
import { tg } from "../lib/telegram";

export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const user = tg?.initDataUnsafe.user;
  const { name, profile, setTab } = useApp();
  return (
    <div className="screen profile">
      <TraderScene equipped={profile.rpg.equipped} />
      <div className="scene-caption">
        <div>
          <b>{name}</b>
          <div className="muted small">
            {t(`ranks.${rankKey(profile.level)}`)} · {t("hud.level", { level: profile.level })}
          </div>
        </div>
        <button className="chip active" onClick={() => setTab("career")}>
          {t("profile.upgrade")}
        </button>
      </div>
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
