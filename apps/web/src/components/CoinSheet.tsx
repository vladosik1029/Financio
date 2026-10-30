import { COINS, isCoinUnlocked } from "@financio/shared";
import { useTranslation } from "react-i18next";
import { formatPrice } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** Список пар в шторке: закрытые по уровню монеты видны, но выбрать их нельзя */
export function CoinSheet({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const tickers = useMarket((s) => s.tickers);
  const { symbol, setSymbol, profile } = useApp();

  return (
    <Sheet title={t("trade.pairs")} onClose={onClose}>
      <div className="coin-list">
        {COINS.map((coin) => {
          const locked = !isCoinUnlocked(coin, profile.level);
          const price = tickers[coin.symbol]?.last;
          return (
            <button
              key={coin.symbol}
              disabled={locked}
              className={coin.symbol === symbol ? "coin-row active" : "coin-row"}
              onClick={() => {
                haptic.tap();
                setSymbol(coin.symbol);
                onClose();
              }}
            >
              <span>
                <b>{coin.base}</b>
                <span className="muted">USDT</span>
              </span>
              {locked ? (
                <span className="muted small lock">
                  <Icon name="lock" size={14} /> {t("hud.level", { level: coin.minLevel })}
                </span>
              ) : (
                <span className="mono">{price ? formatPrice(price, coin.pricePrecision) : "—"}</span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
