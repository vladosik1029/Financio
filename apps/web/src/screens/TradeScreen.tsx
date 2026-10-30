import { getCoin } from "@financio/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoinBar } from "../components/CoinBar";
import { PriceChart } from "../components/PriceChart";
import { TimeframeTabs } from "../components/TimeframeTabs";
import { TradePanel } from "../components/TradePanel";
import { formatPercent, formatPrice } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function TradeScreen() {
  const { t } = useTranslation();
  const { symbol, tf } = useApp();
  const { tickers, stale, connected } = useMarket();
  const ticker = tickers[symbol];
  const coin = getCoin(symbol)!;
  const now = useNow(1000);

  return (
    <div className="screen trade">
      <CoinBar />
      {!connected && <div className="banner">{t("market.offline")}</div>}
      {connected && stale && <div className="banner">{t("market.stale")}</div>}
      <div className="price-row">
        <div>
          <div className="pair">{coin.base}/USDT · Perp</div>
          <div className="price mono">{ticker ? formatPrice(ticker.last, coin.pricePrecision) : "—"}</div>
        </div>
        {ticker && (
          <div className="funding">
            <span className="muted">{t("market.funding")}</span>
            <span className="mono">{formatPercent(ticker.fundingRate)}</span>
            <span className="muted small">
              {t("market.nextFunding", { time: countdown(ticker.nextFundingTime - now) })}
            </span>
          </div>
        )}
      </div>
      <TimeframeTabs />
      <PriceChart symbol={symbol} tf={tf} />
      <TradePanel />
    </div>
  );
}
