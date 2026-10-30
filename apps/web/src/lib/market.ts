import type { Candle, ServerMessage, Ticker, TimeframeId } from "@financio/shared";
import { create } from "zustand";
import { WS_URL } from "./api";
import { useApp } from "./store";
import { haptic } from "./telegram";

interface MarketState {
  tickers: Record<string, Ticker>;
  stale: boolean;
  connected: boolean;
}

export const useMarket = create<MarketState>(() => ({ tickers: {}, stale: false, connected: false }));

type CandleListener = (candle: Candle) => void;

/** Одно WebSocket-соединение на всё приложение с автопереподключением */
class MarketSocket {
  private ws?: WebSocket;
  private retryMs = 1000;
  private readonly listeners = new Map<string, Set<CandleListener>>();

  connect(): void {
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      useMarket.setState({ connected: true });
      for (const key of this.listeners.keys()) this.sendSubscribe("subscribe", key);
      // Пока соединения не было, позиции могли закрыться: подтягиваем актуальное состояние
      void useApp.getState().refresh();
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerMessage);
    ws.onclose = () => {
      useMarket.setState({ connected: false });
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15_000);
    };
  }

  /** Подписка на обновления свечи; возвращает функцию отписки */
  subscribeCandles(symbol: string, tf: TimeframeId, listener: CandleListener): () => void {
    const key = `${symbol}:${tf}`;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
      this.sendSubscribe("subscribe", key);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(key);
        this.sendSubscribe("unsubscribe", key);
      }
    };
  }

  private sendSubscribe(type: "subscribe" | "unsubscribe", key: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const [symbol, tf] = key.split(":");
    this.ws.send(JSON.stringify({ type, symbol, tf }));
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "tickers": {
        const tickers: Record<string, Ticker> = {};
        for (const t of msg.tickers) tickers[t.symbol] = t;
        useMarket.setState({ tickers, stale: msg.stale });
        break;
      }
      case "candle":
        this.listeners.get(`${msg.symbol}:${msg.tf}`)?.forEach((l) => l(msg.candle));
        break;
      case "position":
        useApp.getState().applyPosition(msg.event, msg.position);
        if (msg.event === "closed" && msg.position.closeReason === "liquidation") haptic.error();
        else if (msg.event === "closed" && msg.position.closeReason !== "manual") haptic.warning();
        break;
      case "balance":
        useApp.getState().setBalance(msg.balance);
        break;
    }
  }
}

export const marketSocket = new MarketSocket();
