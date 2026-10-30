import type { Candle, Timeframe } from "@financio/shared";
import WebSocket from "ws";
import type { FeedHandlers, PriceFeed } from "./feed.js";

export interface BinanceFeedOptions {
  symbols: readonly string[];
  wsUrl?: string;
  restUrl?: string;
  /** Через сколько мс тишины считать соединение мёртвым и переподключаться */
  silenceTimeoutMs?: number;
  log?: (msg: string) => void;
}

interface AggTradeEvent {
  e: "aggTrade";
  s: string;
  p: string;
  q: string;
  T: number;
}

interface MarkPriceEvent {
  e: "markPriceUpdate";
  s: string;
  p: string;
  r: string;
  T: number;
  E: number;
}

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

/**
 * Публичные потоки Binance USDT-M Futures: сделки (aggTrade) и mark price
 * с ставкой funding (markPrice@1s). Ключ API не нужен.
 *
 * С 23.04.2026 Binance отключил старый адрес /stream: aggTrade и markPrice
 * теперь отдаются только через /market/stream.
 */
export class BinanceFeed implements PriceFeed {
  readonly name = "binance";
  private ws?: WebSocket;
  private handlers?: FeedHandlers;
  private stopped = false;
  private reconnectDelay = 1000;
  private silenceTimer?: NodeJS.Timeout;
  private readonly wsUrl: string;
  private readonly restUrl: string;
  private readonly silenceTimeoutMs: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BinanceFeedOptions) {
    this.wsUrl = opts.wsUrl ?? "wss://fstream.binance.com/market/stream";
    this.restUrl = opts.restUrl ?? "https://fapi.binance.com";
    this.silenceTimeoutMs = opts.silenceTimeoutMs ?? 10_000;
    this.log = opts.log ?? (() => {});
  }

  start(handlers: FeedHandlers): void {
    this.handlers = handlers;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.silenceTimer);
    this.ws?.close();
  }

  async fetchHistory(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    if (!tf.binanceInterval) return [];
    const url = `${this.restUrl}/fapi/v1/klines?symbol=${symbol}&interval=${tf.binanceInterval}&limit=${Math.min(limit, 1500)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const rows = (await res.json()) as BinanceKline[];
    return rows.map((k) => ({
      time: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  }

  private connect(): void {
    const streams = this.opts.symbols
      .flatMap((s) => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@markPrice@1s`])
      .join("/");
    const ws = new WebSocket(`${this.wsUrl}?streams=${streams}`);
    this.ws = ws;

    ws.on("open", () => {
      this.log("Binance: подключено");
      this.reconnectDelay = 1000;
      this.armSilenceTimer();
    });
    ws.on("message", (raw) => {
      this.armSilenceTimer();
      this.handle(raw.toString());
    });
    ws.on("error", (err) => this.log(`Binance: ошибка ${err.message}`));
    ws.on("close", () => {
      clearTimeout(this.silenceTimer);
      if (this.stopped) return;
      this.log(`Binance: соединение закрыто, переподключение через ${this.reconnectDelay} мс`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    });
  }

  private armSilenceTimer(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.log("Binance: нет данных, переподключаюсь");
      this.ws?.terminate();
    }, this.silenceTimeoutMs);
  }

  private handle(text: string): void {
    let msg: { data?: AggTradeEvent | MarkPriceEvent };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const d = msg.data;
    if (!d || !this.handlers) return;
    if (d.e === "aggTrade") {
      this.handlers.onTrade(d.s, Number(d.p), Number(d.q), d.T);
    } else if (d.e === "markPriceUpdate") {
      this.handlers.onMark(d.s, Number(d.p), Number(d.r), d.T, d.E);
    }
  }
}
