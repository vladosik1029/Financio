export interface Coin {
  /** Символ фьючерсного контракта на Binance, например BTCUSDT */
  symbol: string;
  /** Тикер базовой монеты */
  base: string;
  name: string;
  /** Уровень игрока, с которого монета доступна для торговли */
  minLevel: number;
  /** Сколько знаков после запятой показывать в цене */
  pricePrecision: number;
}

export const COINS: readonly Coin[] = [
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", minLevel: 1, pricePrecision: 1 },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum", minLevel: 1, pricePrecision: 2 },
  { symbol: "SOLUSDT", base: "SOL", name: "Solana", minLevel: 5, pricePrecision: 3 },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB", minLevel: 5, pricePrecision: 2 },
  { symbol: "XRPUSDT", base: "XRP", name: "XRP", minLevel: 5, pricePrecision: 4 },
  { symbol: "DOGEUSDT", base: "DOGE", name: "Dogecoin", minLevel: 5, pricePrecision: 5 },
  { symbol: "TONUSDT", base: "TON", name: "Toncoin", minLevel: 5, pricePrecision: 4 },
  { symbol: "LINKUSDT", base: "LINK", name: "Chainlink", minLevel: 5, pricePrecision: 3 },
];

const bySymbol = new Map(COINS.map((c) => [c.symbol, c]));

export function getCoin(symbol: string): Coin | undefined {
  return bySymbol.get(symbol);
}

export function isCoinUnlocked(coin: Coin, level: number): boolean {
  return level >= coin.minLevel;
}
