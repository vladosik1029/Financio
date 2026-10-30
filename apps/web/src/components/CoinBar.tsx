import { COINS, isCoinUnlocked } from "@financio/shared";
import { formatPrice } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

export function CoinBar() {
  const tickers = useMarket((s) => s.tickers);
  const { symbol, setSymbol, profile } = useApp();

  return (
    <div className="coinbar">
      {COINS.map((coin) => {
        const locked = !isCoinUnlocked(coin, profile.level);
        const price = tickers[coin.symbol]?.last;
        return (
          <button
            key={coin.symbol}
            disabled={locked}
            className={coin.symbol === symbol ? "coin active" : "coin"}
            onClick={() => {
              haptic.tap();
              setSymbol(coin.symbol);
            }}
          >
            <span className="coin-base">{locked ? `🔒 ${coin.base}` : coin.base}</span>
            <span className="coin-price mono">
              {locked ? `Lv.${coin.minLevel}` : price ? formatPrice(price, coin.pricePrecision) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
