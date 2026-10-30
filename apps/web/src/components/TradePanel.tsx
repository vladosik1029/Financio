import {
  getCoin,
  liquidationPrice,
  positionNotional,
  positionQuantity,
  tradingFee,
  type Side,
} from "@financio/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatPrice, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

const MARGIN_PRESETS = [0.1, 0.25, 0.5, 1];

export function TradePanel() {
  const { t } = useTranslation();
  const { symbol, profile } = useApp();
  const ticker = useMarket((s) => s.tickers[symbol]);
  const stale = useMarket((s) => s.stale || !s.connected);
  const coin = getCoin(symbol)!;

  const [margin, setMargin] = useState(100);
  const [leverage, setLeverage] = useState(10);
  const [notice, setNotice] = useState<string | null>(null);

  const lev = Math.min(Math.max(leverage, profile.minLeverage), profile.maxLeverage);
  const price = ticker?.mark ?? 0;
  const notional = positionNotional(margin, lev);
  const qty = price ? positionQuantity(margin, lev, price) : 0;

  const open = (side: Side) => {
    haptic.impact();
    setNotice(`${t(`trade.${side}`)}: ${t("trade.soon")}`);
    setTimeout(() => setNotice(null), 2500);
  };

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
            max={profile.balance}
            value={margin}
            onChange={(e) => setMargin(Math.max(0, Math.min(profile.balance, Number(e.target.value) || 0)))}
          />
        </div>
        <div className="chips">
          {MARGIN_PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => setMargin(Math.floor(profile.balance * p))}>
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
        <dd className="mono">{formatUsd(tradingFee(notional))}</dd>
      </dl>

      {notice && <div className="toast">{notice}</div>}

      <div className="actions">
        <button className="btn btn-long" disabled={stale || margin <= 0} onClick={() => open("long")}>
          {t("trade.long")}
        </button>
        <button className="btn btn-short" disabled={stale || margin <= 0} onClick={() => open("short")}>
          {t("trade.short")}
        </button>
      </div>
    </section>
  );
}
