import type { ServerMessage } from "@financio/shared";
import type { WebSocket } from "ws";

/** Личные WebSocket-каналы игроков: у одного игрока может быть несколько открытых окон */
export class UserChannels {
  private readonly sockets = new Map<number, Set<WebSocket>>();

  add(userId: number, socket: WebSocket): void {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket);
  }

  remove(userId: number, socket: WebSocket): void {
    const set = this.sockets.get(userId);
    set?.delete(socket);
    if (set?.size === 0) this.sockets.delete(userId);
  }

  send = (userId: number, msg: ServerMessage): void => {
    const set = this.sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const s of set) if (s.readyState === s.OPEN) s.send(data);
  };
}
