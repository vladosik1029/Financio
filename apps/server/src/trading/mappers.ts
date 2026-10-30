import type { Position } from "@financio/shared";
import type { PositionRow } from "../db/schema.js";

export function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    status: row.status,
    leverage: row.leverage,
    margin: row.margin,
    invested: row.invested,
    quantity: row.quantity,
    entryPrice: row.entryPrice,
    liquidationPrice: row.liquidationPrice,
    takeProfit: row.takeProfit,
    stopLoss: row.stopLoss,
    openFee: row.openFee,
    closeFee: row.closeFee,
    fundingPaid: row.fundingPaid,
    exitPrice: row.exitPrice,
    realizedPnl: row.realizedPnl,
    closeReason: row.closeReason,
    openedAt: row.openedAt.getTime(),
    closedAt: row.closedAt?.getTime() ?? null,
  };
}
