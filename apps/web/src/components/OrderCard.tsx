import { getCoin, type Order } from "@financio/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey, formatPrice, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { haptic } from "../lib/telegram";

/** Ожидающий ордер: цена, расстояние до рынка и отмена */
export function OrderCard({ order: o }: { order: Order }) {
  const { t } = useTranslation();
  const coin = getCoin(o.symbol)!;
  const last = useMarket((s) => s.tickers[o.symbol]?.last);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const distance = last ? ((o.price - last) / last) * 100 : null;

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelOrder(o.id);
      haptic.success();
    } catch (err) {
      haptic.error();
      setError(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <div className="pos">
      <div className="pos-head">
        <span className={o.side === "long" ? "tag tag-long" : "tag tag-short"}>
          {t(`trade.${o.side}`)} {o.leverage}x
        </span>
        <span className="pos-coin">{coin.base}/USDT</span>
        <span className="tag tag-order">{t(`orders.types.${o.type}`)}</span>
        <button className="chip chip-danger order-cancel" disabled={busy} onClick={cancel}>
          {t("orders.cancel")}
        </button>
      </div>
      <div className="pos-grid mono">
        <span className="muted">{t("orders.price")}</span>
        <span className="muted">{t("orders.distance")}</span>
        <span className="muted">{t("positions.margin")}</span>
        <span className="muted">{t("positions.size")}</span>
        <span>{formatPrice(o.price, coin.pricePrecision)}</span>
        <span>{distance == null ? "—" : `${distance > 0 ? "+" : ""}${distance.toFixed(2)}%`}</span>
        <span>{formatUsd(o.margin)}</span>
        <span>{formatUsd(o.margin * o.leverage)}</span>
      </div>
      {(o.takeProfit != null || o.stopLoss != null) && (
        <div className="pos-sub small muted">
          {o.takeProfit != null && <>TP {formatPrice(o.takeProfit, coin.pricePrecision)} </>}
          {o.stopLoss != null && <>SL {formatPrice(o.stopLoss, coin.pricePrecision)}</>}
        </div>
      )}
      {error && <div className="toast error">{error}</div>}
    </div>
  );
}
