import { getCoin, returnOnEquity, unrealizedPnl, type Position } from "@financio/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey, formatPrice, formatSigned, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { haptic } from "../lib/telegram";

type Mode = "view" | "protect" | "margin";

export function OpenPositionCard({ position: p }: { position: Position }) {
  const { t } = useTranslation();
  const coin = getCoin(p.symbol)!;
  const mark = useMarket((s) => s.tickers[p.symbol]?.mark ?? p.entryPrice);
  const [mode, setMode] = useState<Mode>("view");
  const [tp, setTp] = useState(p.takeProfit?.toString() ?? "");
  const [sl, setSl] = useState(p.stopLoss?.toString() ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pnl = unrealizedPnl(p.side, p.entryPrice, mark, p.quantity);
  const roe = returnOnEquity(pnl, p.margin);
  const fmt = (v: number) => formatPrice(v, coin.pricePrecision);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      haptic.success();
      setMode("view");
    } catch (err) {
      haptic.error();
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);

  return (
    <div className="pos">
      <div className="pos-head">
        <span className={p.side === "long" ? "tag tag-long" : "tag tag-short"}>
          {t(`trade.${p.side}`)} {p.leverage}x
        </span>
        <span className="pos-coin">{coin.base}/USDT</span>
        <span className={`pos-pnl mono ${pnl >= 0 ? "up" : "down"}`}>
          {formatSigned(pnl)} <span className="small">({(roe * 100).toFixed(2)}%)</span>
        </span>
      </div>
      <div className="pos-grid mono">
        <span className="muted">{t("positions.size")}</span>
        <span className="muted">{t("positions.entry")}</span>
        <span className="muted">{t("positions.mark")}</span>
        <span className="muted">{t("positions.liq")}</span>
        <span>{formatUsd(p.quantity * mark)}</span>
        <span>{fmt(p.entryPrice)}</span>
        <span>{fmt(mark)}</span>
        <span className="accent">{fmt(p.liquidationPrice)}</span>
      </div>
      <div className="pos-sub small muted">
        {t("positions.margin")} {formatUsd(p.margin)}
        {p.takeProfit != null && <> · TP {fmt(p.takeProfit)}</>}
        {p.stopLoss != null && <> · SL {fmt(p.stopLoss)}</>}
        {p.fundingPaid !== 0 && (
          <>
            {" "}
            · {t("positions.funding")} {formatSigned(p.fundingPaid)}
          </>
        )}
      </div>

      {mode === "protect" && (
        <div className="protection">
          <label>
            <span className="muted small">{t("trade.takeProfit")}</span>
            <input className="mono input wide" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder={t("trade.optional")} />
          </label>
          <label>
            <span className="muted small">{t("trade.stopLoss")}</span>
            <input className="mono input wide" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder={t("trade.optional")} />
          </label>
        </div>
      )}
      {mode === "margin" && (
        <div className="protection">
          <label>
            <span className="muted small">{t("positions.amount")}</span>
            <input className="mono input wide" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
      )}
      {error && <div className="toast error">{error}</div>}

      <div className="pos-actions">
        {mode === "view" ? (
          <>
            <button className="chip" onClick={() => setMode("protect")}>
              {t("positions.edit")}
            </button>
            <button className="chip" onClick={() => setMode("margin")}>
              {t("positions.addMargin")}
            </button>
            <button className="chip chip-danger" disabled={busy} onClick={() => run(() => api.close(p.id))}>
              {t("positions.close")}
            </button>
          </>
        ) : (
          <>
            <button className="chip" onClick={() => setMode("view")}>
              {t("positions.cancel")}
            </button>
            <button
              className="chip active"
              disabled={busy}
              onClick={() =>
                run(() =>
                  mode === "protect" ? api.protect(p.id, num(tp), num(sl)) : api.addMargin(p.id, num(amount) ?? 0),
                )
              }
            >
              {t("positions.save")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ClosedPositionRow({ position: p }: { position: Position }) {
  const { t } = useTranslation();
  const coin = getCoin(p.symbol)!;
  const pnl = p.realizedPnl ?? 0;
  return (
    <div className="hist">
      <div className="pos-head">
        <span className={p.side === "long" ? "tag tag-long" : "tag tag-short"}>
          {t(`trade.${p.side}`)} {p.leverage}x
        </span>
        <span className="pos-coin">{coin.base}</span>
        <span className={`pos-pnl mono ${pnl >= 0 ? "up" : "down"}`}>{formatSigned(pnl)}</span>
      </div>
      <div className="small muted">
        {t(`positions.reasons.${p.closeReason ?? "manual"}`)} · {formatPrice(p.entryPrice, coin.pricePrecision)} →{" "}
        {p.exitPrice != null ? formatPrice(p.exitPrice, coin.pricePrecision) : "—"} ·{" "}
        {p.closedAt ? new Date(p.closedAt).toLocaleString() : ""}
      </div>
    </div>
  );
}
