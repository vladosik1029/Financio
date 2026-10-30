import { getCoin } from "@financio/shared";
import { useTranslation } from "react-i18next";
import { formatSigned } from "../lib/format";
import { useApp } from "../lib/store";

/** Экран поверх игры: ликвидация, сработавший TP или SL */
export function AlertOverlay() {
  const { t } = useTranslation();
  const { alert, dismissAlert } = useApp();
  if (!alert) return null;
  const p = alert.position;
  const coin = getCoin(p.symbol)!;
  const liquidated = p.closeReason === "liquidation";
  const pnl = p.realizedPnl ?? 0;

  return (
    <div className={liquidated ? "overlay overlay-liq" : "overlay"} onClick={dismissAlert}>
      <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
        <div className={liquidated ? "overlay-title down" : "overlay-title"}>
          {liquidated ? t("alert.liquidation") : t(`alert.${p.closeReason}`)}
        </div>
        {liquidated ? (
          <p>{t("alert.liquidationText", { side: t(`trade.${p.side}`), coin: coin.base, lev: p.leverage })}</p>
        ) : (
          <p>
            {t(`trade.${p.side}`)} {coin.base} {p.leverage}x
          </p>
        )}
        <div className="muted small">{t("alert.result")}</div>
        <div className={`overlay-pnl mono ${pnl >= 0 ? "up" : "down"}`}>{formatSigned(pnl)}</div>
        <button className="btn btn-gold" onClick={dismissAlert}>
          {t("alert.ok")}
        </button>
      </div>
    </div>
  );
}
