import {
  getCoin,
  liquidationPrice,
  MAKER_FEE_RATE,
  positionNotional,
  positionQuantity,
  type OrderType,
  type Side,
} from "@financio/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey, formatPrice, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";
import { Icon } from "./Icon";
import { LeverageSheet } from "./LeverageSheet";

const MARGIN_STEPS = [0, 25, 50, 75, 100];
const ORDER_TYPES: OrderType[] = ["market", "limit", "stop"];

function parsePrice(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

/** Форма ордера в стиле Bybit: плечо в шторке, маржа слайдером, лонг и шорт с ценой ликвидации */
export function TradePanel() {
  const { t } = useTranslation();
  const { symbol, profile, online } = useApp();
  const ticker = useMarket((s) => s.tickers[symbol]);
  const stale = useMarket((s) => s.stale || !s.connected);
  const coin = getCoin(symbol)!;

  const [orderType, setOrderType] = useState<OrderType>("market");
  const [orderPrice, setOrderPrice] = useState("");
  const [margin, setMargin] = useState(100);
  const [leverage, setLeverage] = useState(10);
  const [levOpen, setLevOpen] = useState(false);
  const [showProtection, setShowProtection] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  // При смене монеты или типа ордера подставляем текущую цену как отправную точку
  const lastPrice = ticker?.last;
  useEffect(() => {
    if (orderType !== "market" && lastPrice) setOrderPrice(lastPrice.toFixed(coin.pricePrecision));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, symbol]);

  const lev = Math.min(Math.max(leverage, profile.minLeverage), profile.maxLeverage);
  const pending = orderType !== "market";
  const typedPrice = parsePrice(orderPrice);
  const price = pending ? (typedPrice ?? 0) : (ticker?.last ?? 0);
  const notional = positionNotional(margin, lev);
  const qty = price ? positionQuantity(margin, lev, price) : 0;
  // Лимит исполняется как maker, рыночный и стоп — как taker
  const feeRate = orderType === "limit" ? Math.min(MAKER_FEE_RATE, profile.takerFeeRate) : profile.takerFeeRate;
  const fee = notional * feeRate;
  const maxMargin = Math.max(0, Math.floor((profile.balance / (1 + lev * profile.takerFeeRate)) * 100) / 100);
  const pct = maxMargin > 0 ? Math.min(100, Math.round((margin / maxMargin) * 100)) : 0;
  const fmt = (v: number) => formatPrice(v, coin.pricePrecision);

  const flash = (text: string, error: boolean) => {
    setNotice({ text, error });
    setTimeout(() => setNotice(null), 3000);
  };

  const open = async (side: Side) => {
    haptic.impact();
    setBusy(true);
    const req = {
      symbol,
      side,
      margin,
      leverage: lev,
      takeProfit: showProtection ? parsePrice(tp) : null,
      stopLoss: showProtection ? parsePrice(sl) : null,
    };
    try {
      if (pending) {
        await api.placeOrder({ ...req, type: orderType, price: typedPrice });
        flash(t("orders.placed", { type: t(`orders.types.${orderType}`), side: t(`trade.${side}`), coin: coin.base }), false);
      } else {
        await api.open(req);
        flash(t("trade.opened", { side: t(`trade.${side}`), coin: coin.base }), false);
      }
      haptic.success();
      setTp("");
      setSl("");
    } catch (err) {
      haptic.error();
      flash(t(errorKey(err)), true);
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || stale || !online || margin < 1 || margin > maxMargin || (pending && !typedPrice);

  return (
    <section className="order">
      <div className="order-types">
        {ORDER_TYPES.map((type) => (
          <button
            key={type}
            className={type === orderType ? "otype active" : "otype"}
            onClick={() => {
              haptic.tap();
              setOrderType(type);
            }}
          >
            {t(`orders.types.${type}`)}
          </button>
        ))}
      </div>
      <div className="order-mode">
        <span className="pill">{t("trade.isolated")}</span>
        <button className="pill pill-brand" onClick={() => setLevOpen(true)}>
          {lev}x <Icon name="chevron" size={14} />
        </button>
        <span className="order-avail muted small">
          {t("trade.available")} <span className="mono">{formatUsd(profile.balance)}</span>
        </span>
      </div>

      {pending && (
        <>
          <label className="amount">
            <span className="muted small">{t(orderType === "limit" ? "orders.limitPrice" : "orders.triggerPrice")}</span>
            <input
              className="mono"
              inputMode="decimal"
              value={orderPrice}
              onChange={(e) => setOrderPrice(e.target.value)}
            />
            <span className="muted">USDT</span>
          </label>
          <p className="muted small hint">{t(`orders.hint.${orderType}`)}</p>
        </>
      )}

      <label className="amount">
        <span className="muted small">{t("trade.margin")}</span>
        <input
          className="mono"
          type="number"
          inputMode="decimal"
          min={1}
          max={maxMargin}
          value={margin}
          onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="muted">USDT</span>
      </label>

      <div className="steps">
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setMargin(Math.floor(maxMargin * Number(e.target.value)) / 100)}
        />
        <div className="step-marks">
          {MARGIN_STEPS.map((s) => (
            <button
              key={s}
              className={pct >= s ? "step on" : "step"}
              onClick={() => {
                haptic.tap();
                setMargin(Math.floor(maxMargin * s) / 100);
              }}
            >
              {s}%
            </button>
          ))}
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={showProtection} onChange={(e) => setShowProtection(e.target.checked)} />
        <span>{t("trade.protection")}</span>
      </label>
      {showProtection && (
        <div className="protection">
          <label>
            <span className="muted small">{t("trade.takeProfit")}</span>
            <input className="mono input wide" inputMode="decimal" placeholder={t("trade.optional")} value={tp} onChange={(e) => setTp(e.target.value)} />
          </label>
          <label>
            <span className="muted small">{t("trade.stopLoss")}</span>
            <input className="mono input wide" inputMode="decimal" placeholder={t("trade.optional")} value={sl} onChange={(e) => setSl(e.target.value)} />
          </label>
        </div>
      )}

      <dl className="stats">
        <dt>{t("trade.size")}</dt>
        <dd className="mono">
          {formatUsd(notional)} <span className="muted">≈ {qty.toFixed(4)} {coin.base}</span>
        </dd>
        <dt>{t(orderType === "limit" ? "trade.feeMaker" : "trade.fee")}</dt>
        <dd className="mono">{formatUsd(fee)}</dd>
      </dl>

      {notice && <div className={notice.error ? "toast error" : "toast"}>{notice.text}</div>}

      <div className="actions">
        <button className="btn btn-long" disabled={disabled} onClick={() => open("long")}>
          <span>{t("trade.long")}</span>
          <span className="btn-sub mono">
            {t("trade.liq")} {price ? fmt(liquidationPrice("long", price, lev)) : "—"}
          </span>
        </button>
        <button className="btn btn-short" disabled={disabled} onClick={() => open("short")}>
          <span>{t("trade.short")}</span>
          <span className="btn-sub mono">
            {t("trade.liq")} {price ? fmt(liquidationPrice("short", price, lev)) : "—"}
          </span>
        </button>
      </div>

      {levOpen && (
        <LeverageSheet
          value={lev}
          min={profile.minLeverage}
          max={profile.maxLeverage}
          onApply={setLeverage}
          onClose={() => setLevOpen(false)}
        />
      )}
    </section>
  );
}
