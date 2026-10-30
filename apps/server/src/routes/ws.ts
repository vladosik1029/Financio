import { getCoin, getTimeframe, type ClientMessage, type ServerMessage } from "@financio/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { MarketHub } from "../market/hub.js";

/** Как часто рассылать тикеры всем клиентам */
const TICKERS_INTERVAL_MS = 1000;
/** Не чаще чем раз в столько мс отправлять обновление одной свечи */
const CANDLE_THROTTLE_MS = 250;
const MAX_SUBSCRIPTIONS = 8;

interface Client {
  socket: WebSocket;
  subs: Set<string>;
}

/** Публичный поток рыночных данных: тикеры всех монет и свечи по подписке */
export async function wsRoutes(app: FastifyInstance, opts: { hub: MarketHub }): Promise<void> {
  const { hub } = opts;
  const clients = new Set<Client>();
  const pending = new Map<string, ServerMessage>();

  const send = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  hub.onCandle((symbol, tf, candle) => {
    pending.set(`${symbol}:${tf}`, { type: "candle", symbol, tf, candle: { ...candle } });
  });

  const candleTimer = setInterval(() => {
    if (pending.size === 0) return;
    for (const [key, msg] of pending) {
      for (const c of clients) if (c.subs.has(key)) send(c.socket, msg);
    }
    pending.clear();
  }, CANDLE_THROTTLE_MS);

  const tickerTimer = setInterval(() => {
    const msg: ServerMessage = { type: "tickers", tickers: hub.getTickers(), stale: hub.stale };
    for (const c of clients) send(c.socket, msg);
  }, TICKERS_INTERVAL_MS);

  app.addHook("onClose", async () => {
    clearInterval(candleTimer);
    clearInterval(tickerTimer);
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const client: Client = { socket, subs: new Set() };
    clients.add(client);
    send(socket, { type: "tickers", tickers: hub.getTickers(), stale: hub.stale });

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: "error", message: "bad_json" });
      }
      if (msg.type === "ping") return send(socket, { type: "pong" });
      if (msg.type !== "subscribe" && msg.type !== "unsubscribe") return;
      if (!getCoin(msg.symbol) || !getTimeframe(msg.tf)) {
        return send(socket, { type: "error", message: "unknown_stream" });
      }
      const key = `${msg.symbol}:${msg.tf}`;
      if (msg.type === "unsubscribe") return void client.subs.delete(key);
      if (client.subs.size >= MAX_SUBSCRIPTIONS) {
        return send(socket, { type: "error", message: "too_many_subscriptions" });
      }
      client.subs.add(key);
    });

    socket.on("close", () => clients.delete(client));
  });
}
