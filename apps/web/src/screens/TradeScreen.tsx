import { getCoin } from "@financio/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoinSheet } from "../components/CoinSheet";
import { Icon } from "../components/Icon";
import { LoanBanner } from "../components/LoanBanner";
import { OrderCard } from "../components/OrderCard";
import { OpenPositionCard } from "../components/PositionCard";
import { PriceChart } from "../components/PriceChart";
import { TimeframeTabs } from "../components/TimeframeTabs";
import { TradePanel } from "../components/TradePanel";
import { formatPercent, formatPrice } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";
import { clock, useNow } from "../lib/useNow";
import { EventBanner } from "../components/EventBanner";

/** Цвет цены по направлению последнего тика, как в стакане биржи */
function useTickDirection(price: number | undefined): "up" | "down" | "" {
  const prev = useRef<number | undefined>(undefined);
  const [dir, setDir] = useState<"up" | "down" | "">("");
  useEffect(() => {
    if (price != null && prev.current != null && price !== prev.current) setDir(price > prev.current ? "up" : "down");
    prev.current = price;
  }, [price]);
  return dir;
}

export function TradeScreen() {
  const { t } = useTranslation();
  const { symbol, tf, open, orders } = useApp();
  const breakUntil = useApp((s) => s.profile.tilt.breakUntil);
  const { tickers, stale, connected } = useMarket();
  const ticker = tickers[symbol];
  const coin = getCoin(symbol)!;
  const now = useNow(1000);
  const dir = useTickDirection(ticker?.last);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [view, setView] = useState<"order" | "positions" | "orders">("order");

  return (
    <div className="screen trade">
      <div className="pair-head">
        <button
          className="pair-btn"
          onClick={() => {
            haptic.tap();
            setPairsOpen(true);
          }}
        >
          <b>{coin.base}USDT</b>
          <span className="muted small">{t("trade.perp")}</span>
          <Icon name="chevron" size={16} />
        </button>
        <div className={`price mono ${dir}`}>{ticker ? formatPrice(ticker.last, coin.pricePrecision) : "—"}</div>
      </div>
      <div className="ticker-stats">
        <div>
          <span className="muted">{t("market.mark")}</span>
          <span className="mono">{ticker ? formatPrice(ticker.mark, coin.pricePrecision) : "—"}</span>
        </div>
        <div>
          <span className="muted">{t("market.funding")}</span>
          <span className="mono">
            {ticker ? `${formatPercent(ticker.fundingRate)} · ${clock(ticker.nextFundingTime - now)}` : "—"}
          </span>
        </div>
      </div>
      {!connected && <div className="banner">{t("market.offline")}</div>}
      {connected && stale && <div className="banner">{t("market.stale")}</div>}
      {breakUntil && breakUntil > now && (
        <div className="banner">{t("tilt.onBreakBanner", { time: clock(breakUntil - now) })}</div>
      )}
      <EventBanner compact />

      <TimeframeTabs />
      <PriceChart symbol={symbol} tf={tf} />
      <LoanBanner />

      <div className="segment">
        <button className={view === "order" ? "seg active" : "seg"} onClick={() => setView("order")}>
          {t("trade.order")}
        </button>
        <button className={view === "positions" ? "seg active" : "seg"} onClick={() => setView("positions")}>
          {t("positions.short")} ({open.length})
        </button>
        <button className={view === "orders" ? "seg active" : "seg"} onClick={() => setView("orders")}>
          {t("orders.title")} ({orders.length})
        </button>
      </div>
      {view === "order" ? (
        <TradePanel />
      ) : view === "orders" ? (
        orders.length === 0 ? (
          <p className="muted">{t("orders.none")}</p>
        ) : (
          orders.map((o) => <OrderCard key={o.id} order={o} />)
        )
      ) : open.length === 0 ? (
        <p className="muted">{t("positions.none")}</p>
      ) : (
        open.map((p) => <OpenPositionCard key={p.id} position={p} />)
      )}

      {pairsOpen && <CoinSheet onClose={() => setPairsOpen(false)} />}
    </div>
  );
}
