import type { TradeErrorCode } from "@financio/shared";

/** Ошибка игровой операции: код уходит клиенту и переводится на язык игрока */
export class TradeError extends Error {
  constructor(readonly code: TradeErrorCode) {
    super(code);
  }
}
