import { useTranslation } from "react-i18next";
import { formatUsd } from "../lib/format";
import { useApp } from "../lib/store";

export function Hud() {
  const { t } = useTranslation();
  const { name, profile } = useApp();
  const xpPct = Math.min(100, (profile.xp / profile.xpToNext) * 100);

  return (
    <header className="hud">
      <div className="hud-avatar">{name.slice(0, 1).toUpperCase()}</div>
      <div className="hud-main">
        <div className="hud-row">
          <span className="hud-name">{name}</span>
          <span className="hud-level">{t("hud.level", { level: profile.level })}</span>
        </div>
        <div className="xp-bar">
          <div className="xp-fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>
      <div className="hud-balance">
        <span className="muted">{t("hud.balance")}</span>
        <span className="mono">{formatUsd(profile.balance)}</span>
      </div>
    </header>
  );
}
