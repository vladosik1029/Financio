import {
  getCoin,
  liquidationPrice,
  positionNotional,
  positionQuantity,
  type Side,
} from "@financio/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey, formatPrice, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

const MARGIN_PRESETS = [0.1, 0.25, 0.5, 1];

function parsePrice(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function TradePanel() {
  const { t } = useTranslation();
  const { symbol, profile, online } = useApp();
  const ticker = useMarket((s) => s.tickers[symbol]);
  const stale = useMarket((s) => s.stale || !s.connected);
  const coin = getCoin(symbol)!;

  const [margin, setMargin] = useState(100);
  const [leverage, setLeverage] = useState(10);
  const [showProtection, setShowProtection] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const lev = Math.min(Math.max(leverage, profile.minLeverage), profile.maxLeverage);
  const price = ticker?.last ?? 0;
  const notional = positionNotional(margin, lev);
  const qty = price ? positionQuantity(margin, lev, price) : 0;
  const fee = notional * profile.takerFeeRate;
  const maxMargin = Math.max(0, Math.floor((profile.balance / (1 + lev * profile.takerFeeRate)) * 100) / 100);

  const flash = (text: string, error: boolean) => {
    setNotice({ text, error });
    setTimeout(() => setNotice(null), 3000);
  };

  const open = async (side: Side) => {
    haptic.impact();
    setBusy(true);
    try {
      await api.open({
        symbol,
        side,
        margin,
        leverage: lev,
        takeProfit: showProtection ? parsePrice(tp) : null,
        stopLoss: showProtection ? parsePrice(sl) : null,
      });
      haptic.success();
      flash(t("trade.opened", { side: t(`trade.${side}`), coin: coin.base }), false);
      setTp("");
      setSl("");
    } catch (err) {
      haptic.error();
      flash(t(errorKey(err)), true);
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || stale || !online || margin < 1 || margin > maxMargin;

  return (
    <section className="panel">
      <div className="field">
        <div className="field-head">
          <span>{t("trade.margin")}</span>
          <input
            className="mono input"
            type="number"
            inputMode="decimal"
            min={1}
            max={maxMargin}
            value={margin}
            onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="chips">
          {MARGIN_PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => setMargin(Math.floor(maxMargin * p * 100) / 100)}>
              {p * 100}%
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <span>{t("trade.leverage")}</span>
          <span className="mono accent">{lev}x</span>
        </div>
        <input
          type="range"
          className="slider"
          min={profile.minLeverage}
          max={profile.maxLeverage}
          step={1}
          value={lev}
          onChange={(e) => {
            haptic.tap();
            setLeverage(Number(e.target.value));
          }}
        />
        <div className="muted small">{t("trade.leverageMax", { max: profile.maxLeverage })}</div>
      </div>

      <div className="field">
        <button className="link" onClick={() => setShowProtection((v) => !v)}>
          {showProtection ? "▾" : "▸"} {t("trade.protection")}
        </button>
        {showProtection && (
          <div className="protection">
            <label>
              <span className="muted small">{t("trade.takeProfit")}</span>
              <input
                className="mono input wide"
                inputMode="decimal"
                placeholder={t("trade.optional")}
                value={tp}
                onChange={(e) => setTp(e.target.value)}
              />
            </label>
            <label>
              <span className="muted small">{t("trade.stopLoss")}</span>
              <input
                className="mono input wide"
                inputMode="decimal"
                placeholder={t("trade.optional")}
                value={sl}
                onChange={(e) => setSl(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <dl className="stats">
        <dt>{t("trade.size")}</dt>
        <dd className="mono">{formatUsd(notional)}</dd>
        <dt>{t("trade.quantity")}</dt>
        <dd className="mono">
          {qty.toFixed(6)} {coin.base}
        </dd>
        <dt>{t("trade.liquidation")}</dt>
        <dd className="mono">
          {price ? (
            <>
              <span className="up">{formatPrice(liquidationPrice("long", price, lev), coin.pricePrecision)}</span>
              {" / "}
              <span className="down">{formatPrice(liquidationPrice("short", price, lev), coin.pricePrecision)}</span>
            </>
          ) : (
            "—"
          )}
        </dd>
        <dt>{t("trade.fee")}</dt>
        <dd className="mono">{formatUsd(fee)}</dd>
      </dl>

      {notice && <div className={notice.error ? "toast error" : "toast"}>{notice.text}</div>}

      <div className="actions">
        <button className="btn btn-long" disabled={disabled} onClick={() => open("long")}>
          {t("trade.long")}
        </button>
        <button className="btn btn-short" disabled={disabled} onClick={() => open("short")}>
          {t("trade.short")}
        </button>
      </div>
    </section>
  );
}
