import {
  checkLeverage,
  fillPrice,
  fundingPayment,
  FUNDING_INTERVAL_MS,
  getCoin,
  isCoinUnlocked,
  isLiquidated,
  liquidationPrice,
  liquidationPriceForMargin,
  maintenanceMarginRate,
  MAKER_FEE_RATE,
  maxLeverageForLevel,
  MIN_LEVERAGE,
  xpToNextLevel,
  orderPriceValid,
  orderTriggered,
  stopLossHit,
  takeProfitHit,
  unrealizedPnl,
  type CloseReason,
  type OpenPositionRequest,
  type Order,
  type Position,
  type Profile,
  type ServerMessage,
  type Side,
  type Ticker,
} from "@financio/shared";
import { and, count, desc, eq, ne } from "drizzle-orm";
import type { TelegramUser } from "../auth/telegram.js";
import type { Db } from "../db/index.js";
import { ledger, orders, positions, users, type OrderRow, type PositionRow, type UserRow } from "../db/schema.js";
import { toOrder, toPosition } from "./mappers.js";
import { TradeError } from "./errors.js";
import { ProgressService } from "./progress.js";
import { RpgService } from "./rpg.js";
import type { SettingsStore } from "./settings.js";

export { TradeError };

/** Что движку нужно знать о рынке */
export interface MarketView {
  readonly stale: boolean;
  getTicker(symbol: string): Ticker | undefined;
}

export type Notify = (userId: number, msg: ServerMessage) => void;

/** Открытая позиция в памяти: всё, что нужно для проверки на каждом тике */
interface WatchedPosition {
  id: number;
  userId: number;
  symbol: string;
  side: Side;
  liquidationPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
}

/** Отложенный ордер в памяти: проверяется на каждом тике mark price */
interface WatchedOrder {
  id: number;
  userId: number;
  symbol: string;
  side: Side;
  type: "limit" | "stop";
  price: number;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const FUNDING_SLOT_KEY = "funding_slot";

/**
 * Серверный торговый движок: все деньги, цены исполнения, ликвидации и funding
 * считаются только здесь. Клиент лишь показывает результат.
 */
export class TradingEngine {
  private readonly watched = new Map<number, WatchedPosition>();
  private readonly closing = new Set<number>();
  private readonly pendingOrders = new Map<number, WatchedOrder>();
  private readonly filling = new Set<number>();
  readonly progress: ProgressService;
  readonly rpg: RpgService;

  constructor(
    private readonly db: Db,
    private readonly market: MarketView,
    private readonly settings: SettingsStore,
    private readonly notify: Notify = () => {},
    private readonly now: () => number = Date.now,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.rpg = new RpgService(db, notify);
    this.progress = new ProgressService(db, notify, now, this.rpg);
  }

  /** Загружает открытые позиции в память после старта сервера */
  async init(): Promise<void> {
    await this.settings.load();
    const rows = await this.db.select().from(positions).where(eq(positions.status, "open"));
    for (const row of rows) this.watch(row);
    const pending = await this.db.select().from(orders).where(eq(orders.status, "pending"));
    for (const row of pending) this.watchOrder(row);
  }

  // ---------- Игроки ----------

  /** Создаёт игрока при первом входе и обновляет его имя при следующих */
  async ensureUser(tg: TelegramUser): Promise<UserRow> {
    const [existing] = await this.db.select().from(users).where(eq(users.id, tg.id));
    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({
          firstName: tg.first_name,
          username: tg.username ?? null,
          languageCode: tg.language_code ?? null,
          lastSeenAt: new Date(this.now()),
        })
        .where(eq(users.id, tg.id))
        .returning();
      return updated!;
    }
    const start = this.settings.get().startingBalance;
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          id: tg.id,
          firstName: tg.first_name,
          username: tg.username ?? null,
          languageCode: tg.language_code ?? null,
          balance: start,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [row] = await tx.select().from(users).where(eq(users.id, tg.id));
        return row!;
      }
      await tx.insert(ledger).values({ userId: tg.id, type: "start", amount: start, balanceAfter: start });
      return created;
    });
  }

  async getProfile(userId: number): Promise<Profile> {
    const user = await this.getUser(userId);
    const s = this.settings.get();
    const rpg = await this.rpg.state(userId);
    const e = rpg.effects;
    return {
      level: user.level,
      xp: user.xp,
      xpToNext: xpToNextLevel(user.level),
      balance: user.balance,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: maxLeverageForLevel(user.level),
      maxOpenPositions: s.maxOpenPositions + e.extraPositions,
      takerFeeRate: s.takerFeeRate * (1 - e.feeDiscount),
      canTakeLoan: this.loanAvailable(user),
      loanAmount: s.loanAmount * (1 + e.loanBonus),
      quests: await this.progress.quests(userId),
      rpg,
    };
  }

  async listPositions(userId: number, scope: "open" | "history", limit = 50): Promise<Position[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(
        and(eq(positions.userId, userId), scope === "open" ? eq(positions.status, "open") : ne(positions.status, "open")),
      )
      .orderBy(desc(scope === "open" ? positions.openedAt : positions.closedAt))
      .limit(limit);
    return rows.map(toPosition);
  }

  // ---------- Сделки ----------

  async listOrders(userId: number, scope: "pending" | "history", limit = 50): Promise<Order[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(
        and(eq(orders.userId, userId), scope === "pending" ? eq(orders.status, "pending") : ne(orders.status, "pending")),
      )
      .orderBy(desc(scope === "pending" ? orders.createdAt : orders.updatedAt))
      .limit(limit);
    return rows.map(toOrder);
  }

  async openPosition(userId: number, req: OpenPositionRequest): Promise<Position> {
    const s = this.settings.get();
    if (!s.tradingEnabled) throw new TradeError("trading_disabled");
    const coin = getCoin(req.symbol);
    if (!coin) throw new TradeError("unknown_symbol");
    const ticker = this.liveTicker(req.symbol);
    if (req.side !== "long" && req.side !== "short") throw new TradeError("bad_leverage");
    if (!Number.isFinite(req.margin) || req.margin < 1) throw new TradeError("bad_margin");
    const e = await this.rpg.effects(userId);

    const { row, balance } = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!isCoinUnlocked(coin, user.level)) throw new TradeError("coin_locked");
      if (!checkLeverage(req.leverage, user.level).ok) throw new TradeError("bad_leverage");

      const [open] = await tx
        .select({ n: count() })
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "open")));
      if ((open?.n ?? 0) >= s.maxOpenPositions + e.extraPositions) throw new TradeError("too_many_positions");

      const notional = req.margin * req.leverage;
      const entry = fillPrice(req.side, "open", ticker.last, notional, e.slippageReduction);
      const quantity = notional / entry;
      const fee = notional * s.takerFeeRate * (1 - e.feeDiscount);
      if (req.margin + fee > user.balance + 1e-9) throw new TradeError("insufficient_balance");

      const liq = liquidationPrice(req.side, entry, req.leverage);
      const tp = req.takeProfit ?? null;
      const sl = req.stopLoss ?? null;
      validateProtection(req.side, entry, liq, tp, sl);

      const balance = user.balance - req.margin - fee;
      await tx.update(users).set({ balance }).where(eq(users.id, userId));
      const [row] = await tx
        .insert(positions)
        .values({
          userId,
          symbol: req.symbol,
          side: req.side,
          leverage: req.leverage,
          margin: req.margin,
          invested: req.margin,
          quantity,
          entryPrice: entry,
          liquidationPrice: liq,
          takeProfit: tp,
          stopLoss: sl,
          openFee: fee,
          openedAt: new Date(this.now()),
        })
        .returning();
      await tx.insert(ledger).values({
        userId,
        type: "open",
        amount: -(req.margin + fee),
        balanceAfter: balance,
        positionId: row!.id,
      });
      return { row: row!, balance };
    });

    this.watch(row);
    const position = toPosition(row);
    this.notify(userId, { type: "position", event: "opened", position });
    this.notify(userId, { type: "balance", balance });
    this.track(this.progress.onPositionOpened(userId));
    return position;
  }

  /** Закрытие игроком по рынку */
  async closePosition(userId: number, positionId: number): Promise<Position> {
    const row = await this.getOwnOpen(userId, positionId);
    const ticker = this.liveTicker(row.symbol);
    const e = await this.rpg.effects(userId);
    const exit = fillPrice(row.side, "close", ticker.last, row.quantity * ticker.last, e.slippageReduction);
    return this.close(positionId, exit, "manual");
  }

  async updateProtection(
    userId: number,
    positionId: number,
    takeProfit: number | null,
    stopLoss: number | null,
  ): Promise<Position> {
    const row = await this.getOwnOpen(userId, positionId);
    const ticker = this.liveTicker(row.symbol);
    validateProtection(row.side, ticker.mark, row.liquidationPrice, takeProfit, stopLoss);
    const [updated] = await this.db
      .update(positions)
      .set({ takeProfit, stopLoss })
      .where(and(eq(positions.id, positionId), eq(positions.status, "open")))
      .returning();
    if (!updated) throw new TradeError("not_found");
    this.watch(updated);
    const position = toPosition(updated);
    this.notify(userId, { type: "position", event: "updated", position });
    return position;
  }

  /** Добавляет маржу в изолированную позицию и отодвигает ликвидацию */
  async addMargin(userId: number, positionId: number, amount: number): Promise<Position> {
    if (!Number.isFinite(amount) || amount <= 0) throw new TradeError("bad_margin");
    const { row, balance } = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (amount > user.balance + 1e-9) throw new TradeError("insufficient_balance");
      const [pos] = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.id, positionId), eq(positions.userId, userId), eq(positions.status, "open")));
      if (!pos) throw new TradeError("not_found");
      const margin = pos.margin + amount;
      const liq = liquidationPriceForMargin(
        pos.side,
        pos.entryPrice,
        pos.quantity,
        margin,
        maintenanceMarginRate(pos.leverage),
      );
      const balance = user.balance - amount;
      await tx.update(users).set({ balance }).where(eq(users.id, userId));
      const [row] = await tx
        .update(positions)
        .set({ margin, invested: pos.invested + amount, liquidationPrice: liq })
        .where(eq(positions.id, positionId))
        .returning();
      await tx.insert(ledger).values({ userId, type: "add_margin", amount: -amount, balanceAfter: balance, positionId });
      return { row: row!, balance };
    });
    this.watch(row);
    const position = toPosition(row);
    this.notify(userId, { type: "position", event: "updated", position });
    this.notify(userId, { type: "balance", balance });
    return position;
  }

  /** Кредит наставника: только банкроту без открытых позиций и не чаще кулдауна */
  async takeLoan(userId: number): Promise<number> {
    const s = this.settings.get();
    const amount = s.loanAmount * (1 + (await this.rpg.effects(userId)).loanBonus);
    const balance = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!this.loanAvailable(user)) throw new TradeError("loan_unavailable");
      const balance = user.balance + amount;
      await tx.update(users).set({ balance, lastLoanAt: new Date(this.now()) }).where(eq(users.id, userId));
      await tx.insert(ledger).values({ userId, type: "loan", amount, balanceAfter: balance });
      return balance;
    });
    this.notify(userId, { type: "balance", balance });
    return balance;
  }

  // ---------- Отложенные ордера ----------

  /**
   * Лимит или стоп: маржа и максимальная комиссия (taker) сразу резервируются с баланса,
   * чтобы к моменту исполнения деньги точно были. Неистраченный остаток вернётся при исполнении.
   */
  async placeOrder(userId: number, req: OpenPositionRequest): Promise<Order> {
    const s = this.settings.get();
    if (!s.tradingEnabled) throw new TradeError("trading_disabled");
    const coin = getCoin(req.symbol);
    if (!coin) throw new TradeError("unknown_symbol");
    const type = req.type;
    if (type !== "limit" && type !== "stop") throw new TradeError("bad_order_price");
    if (req.side !== "long" && req.side !== "short") throw new TradeError("bad_leverage");
    if (!Number.isFinite(req.margin) || req.margin < 1) throw new TradeError("bad_margin");
    const ticker = this.liveTicker(req.symbol);
    const price = Number(req.price);
    if (!orderPriceValid(type, req.side, ticker.last, price)) throw new TradeError("bad_order_price");
    const e = await this.rpg.effects(userId);

    const { row, balance } = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!isCoinUnlocked(coin, user.level)) throw new TradeError("coin_locked");
      if (!checkLeverage(req.leverage, user.level).ok) throw new TradeError("bad_leverage");
      const [pending] = await tx
        .select({ n: count() })
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.status, "pending")));
      if ((pending?.n ?? 0) >= s.maxOpenPositions + e.extraPositions) throw new TradeError("too_many_orders");

      const tp = req.takeProfit ?? null;
      const sl = req.stopLoss ?? null;
      validateProtection(req.side, price, liquidationPrice(req.side, price, req.leverage), tp, sl);

      const reserved = req.margin + req.margin * req.leverage * s.takerFeeRate * (1 - e.feeDiscount);
      if (reserved > user.balance + 1e-9) throw new TradeError("insufficient_balance");
      const balance = user.balance - reserved;
      await tx.update(users).set({ balance }).where(eq(users.id, userId));
      const now = new Date(this.now());
      const [row] = await tx
        .insert(orders)
        .values({
          userId,
          symbol: req.symbol,
          side: req.side,
          type,
          price,
          margin: req.margin,
          leverage: req.leverage,
          takeProfit: tp,
          stopLoss: sl,
          reserved,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(ledger).values({
        userId,
        type: "order_reserve",
        amount: -reserved,
        balanceAfter: balance,
        note: `order #${row!.id}`,
      });
      return { row: row!, balance };
    });

    this.watchOrder(row);
    const order = toOrder(row);
    this.notify(userId, { type: "order", event: "placed", order });
    this.notify(userId, { type: "balance", balance });
    return order;
  }

  async cancelOrder(userId: number, orderId: number): Promise<Order> {
    if (this.filling.has(orderId)) throw new TradeError("not_found");
    return this.finishOrder(orderId, "cancelled", null, userId);
  }

  // ---------- Рынок ----------

  /** Проверка ликвидаций и TP/SL на каждом обновлении mark price */
  onMark(symbol: string, mark: number): void {
    for (const o of this.pendingOrders.values()) {
      if (o.symbol !== symbol || this.filling.has(o.id)) continue;
      if (!orderTriggered(o.type, o.side, mark, o.price)) continue;
      this.fillOrder(o.id, mark).catch((err) => {
        if (!(err instanceof TradeError)) this.log(`Не удалось исполнить ордер ${o.id}: ${(err as Error).message}`);
      });
    }
    for (const p of this.watched.values()) {
      if (p.symbol !== symbol || this.closing.has(p.id)) continue;
      let reason: CloseReason | null = null;
      let exit = mark;
      if (isLiquidated(p.side, mark, p.liquidationPrice)) {
        reason = "liquidation";
        exit = p.liquidationPrice;
      } else if (stopLossHit(p.side, mark, p.stopLoss)) {
        reason = "stop_loss";
      } else if (takeProfitHit(p.side, mark, p.takeProfit)) {
        reason = "take_profit";
      }
      if (!reason) continue;
      if (reason !== "liquidation") exit = fillPrice(p.side, "close", mark, 0);
      this.close(p.id, exit, reason).catch((err) => {
        if (!(err instanceof TradeError)) this.log(`Не удалось закрыть позицию ${p.id}: ${(err as Error).message}`);
      });
    }
  }

  /**
   * Списывает или начисляет funding раз в 8 часов (00:00, 08:00, 16:00 UTC).
   * Платёж идёт из изолированной маржи позиции, поэтому меняет цену ликвидации.
   */
  async processFunding(): Promise<number> {
    const slot = Math.floor(this.now() / FUNDING_INTERVAL_MS);
    const last = await this.settings.getMeta<number>(FUNDING_SLOT_KEY);
    if (last === undefined || slot <= last) {
      if (last === undefined) await this.settings.setMeta(FUNDING_SLOT_KEY, slot);
      return 0;
    }
    await this.settings.setMeta(FUNDING_SLOT_KEY, slot);

    let applied = 0;
    for (const p of [...this.watched.values()]) {
      const ticker = this.market.getTicker(p.symbol);
      if (!ticker || !ticker.mark) continue;
      try {
        await this.applyFunding(p.id, ticker.mark, ticker.fundingRate);
        applied++;
      } catch (err) {
        this.log(`Funding для позиции ${p.id} не применён: ${(err as Error).message}`);
      }
    }
    return applied;
  }

  // ---------- Для админки ----------

  async adminClosePosition(positionId: number): Promise<Position> {
    const [row] = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.status, "open")));
    if (!row) throw new TradeError("not_found");
    const ticker = this.market.getTicker(row.symbol);
    const price = ticker?.last || row.entryPrice;
    return this.close(positionId, price, "admin");
  }

  async adminAdjustBalance(userId: number, amount: number, note: string): Promise<number> {
    const balance = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId, true);
      const balance = user.balance + amount;
      if (balance < 0) throw new TradeError("insufficient_balance");
      await tx.update(users).set({ balance }).where(eq(users.id, userId));
      await tx.insert(ledger).values({ userId, type: "admin_adjust", amount, balanceAfter: balance, note });
      return balance;
    });
    this.notify(userId, { type: "balance", balance });
    return balance;
  }

  /** Сколько позиций сейчас под наблюдением движка */
  get openCount(): number {
    return this.watched.size;
  }

  // ---------- Внутреннее ----------

  private async close(positionId: number, exitPrice: number, reason: CloseReason): Promise<Position> {
    if (this.closing.has(positionId) && reason === "manual") throw new TradeError("not_found");
    this.closing.add(positionId);
    try {
      const s = this.settings.get();
      // Бонусы читаем до транзакции: встроенная база держит одно соединение
      const [owner] = await this.db.select({ userId: positions.userId }).from(positions).where(eq(positions.id, positionId));
      if (!owner) throw new TradeError("not_found");
      const e = await this.rpg.effects(owner.userId);
      const { row, balance } = await this.db.transaction(async (tx) => {
        const [pos] = await tx
          .select()
          .from(positions)
          .where(and(eq(positions.id, positionId), eq(positions.status, "open")))
          .for("update");
        if (!pos) throw new TradeError("not_found");
        const user = await this.lockUser(tx, pos.userId, true);

        let payout = 0;
        let closeFee = 0;
        if (reason !== "liquidation") {
          const pnl = unrealizedPnl(pos.side, pos.entryPrice, exitPrice, pos.quantity);
          closeFee = pos.quantity * exitPrice * s.takerFeeRate * (1 - e.feeDiscount);
          payout = Math.max(0, pos.margin + pnl - closeFee);
        }
        const balance = user.balance + payout;
        const [row] = await tx
          .update(positions)
          .set({
            status: reason === "liquidation" ? "liquidated" : "closed",
            exitPrice,
            closeFee,
            realizedPnl: payout - pos.invested - pos.openFee,
            closeReason: reason,
            closedAt: new Date(this.now()),
          })
          .where(eq(positions.id, positionId))
          .returning();
        await tx.update(users).set({ balance }).where(eq(users.id, pos.userId));
        await tx.insert(ledger).values({
          userId: pos.userId,
          type: "close",
          amount: payout,
          balanceAfter: balance,
          positionId,
          note: reason,
        });
        return { row: row!, balance };
      });

      this.watched.delete(positionId);
      const position = toPosition(row);
      this.notify(row.userId, { type: "position", event: "closed", position });
      this.notify(row.userId, { type: "balance", balance });
      this.track(this.progress.onPositionClosed(position, row.userId));
      return position;
    } finally {
      this.closing.delete(positionId);
    }
  }

  private async applyFunding(positionId: number, mark: number, rate: number): Promise<void> {
    const row = await this.db.transaction(async (tx) => {
      const [pos] = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.id, positionId), eq(positions.status, "open")))
        .for("update");
      if (!pos) return undefined;
      const user = await this.lockUser(tx, pos.userId, true);
      const payment = fundingPayment(pos.side, pos.quantity * mark, rate);
      const margin = pos.margin + payment;
      const liq = liquidationPriceForMargin(
        pos.side,
        pos.entryPrice,
        pos.quantity,
        margin,
        maintenanceMarginRate(pos.leverage),
      );
      const [row] = await tx
        .update(positions)
        .set({ margin, fundingPaid: pos.fundingPaid + payment, liquidationPrice: liq })
        .where(eq(positions.id, positionId))
        .returning();
      await tx.insert(ledger).values({
        userId: pos.userId,
        type: "funding",
        amount: payment,
        balanceAfter: user.balance,
        positionId,
        note: `rate=${rate}`,
      });
      return row!;
    });
    if (!row) return;
    this.watch(row);
    this.notify(row.userId, { type: "position", event: "updated", position: toPosition(row) });
    // Если funding съел маржу, позиция ликвидируется на ближайшем тике mark price
    this.onMark(row.symbol, mark);
  }

  /**
   * Исполнение ордера: лимит — ровно по своей цене с комиссией maker,
   * стоп — по рынку с проскальзыванием и комиссией taker. Если позицию открыть нельзя
   * (лимит позиций, бан), ордер отклоняется и резерв возвращается.
   */
  private async fillOrder(orderId: number, mark: number): Promise<void> {
    this.filling.add(orderId);
    try {
      const s = this.settings.get();
      const [owner] = await this.db.select({ userId: orders.userId }).from(orders).where(eq(orders.id, orderId));
      if (!owner) return;
      const e = await this.rpg.effects(owner.userId);
      const result = await this.db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
          .for("update");
        if (!order) return undefined;
        const user = await this.lockUser(tx, order.userId, true);
        const [open] = await tx
          .select({ n: count() })
          .from(positions)
          .where(and(eq(positions.userId, order.userId), eq(positions.status, "open")));
        const full = (open?.n ?? 0) >= s.maxOpenPositions + e.extraPositions;
        const reject = user.banned ? "banned" : full ? "too_many_positions" : null;
        if (reject) return { kind: "rejected" as const, ...(await this.closeOrderRow(tx, order, user, "rejected", reject)) };

        const notional = order.margin * order.leverage;
        const entry =
          order.type === "limit" ? order.price : fillPrice(order.side, "open", mark, notional, e.slippageReduction);
        const rate = order.type === "limit" ? Math.min(MAKER_FEE_RATE, s.takerFeeRate) : s.takerFeeRate;
        const fee = notional * rate * (1 - e.feeDiscount);
        const liq = liquidationPrice(order.side, entry, order.leverage);
        // Стоп мог исполниться с проскальзыванием: защиту, ставшую неверной, снимаем
        const tp = protectionValid(order.side, entry, liq, order.takeProfit, null) ? order.takeProfit : null;
        const sl = protectionValid(order.side, entry, liq, null, order.stopLoss) ? order.stopLoss : null;
        const refund = Math.max(0, order.reserved - order.margin - fee);
        const balance = user.balance + refund;
        const now = new Date(this.now());
        const [pos] = await tx
          .insert(positions)
          .values({
            userId: order.userId,
            symbol: order.symbol,
            side: order.side,
            leverage: order.leverage,
            margin: order.margin,
            invested: order.margin,
            quantity: notional / entry,
            entryPrice: entry,
            liquidationPrice: liq,
            takeProfit: tp,
            stopLoss: sl,
            openFee: fee,
            openedAt: now,
          })
          .returning();
        const [filled] = await tx
          .update(orders)
          .set({ status: "filled", positionId: pos!.id, updatedAt: now })
          .where(eq(orders.id, orderId))
          .returning();
        if (refund > 0) await tx.update(users).set({ balance }).where(eq(users.id, order.userId));
        await tx.insert(ledger).values({
          userId: order.userId,
          type: "order_refund",
          amount: refund,
          balanceAfter: balance,
          positionId: pos!.id,
          note: `order #${orderId} filled`,
        });
        return { kind: "filled" as const, filled: filled!, position: pos!, balance };
      });
      if (!result) return;
      this.pendingOrders.delete(orderId);
      if (result.kind === "rejected") {
        this.announceOrder(result.order, "rejected", result.balance);
        return;
      }
      this.watch(result.position);
      this.notify(result.filled.userId, { type: "order", event: "filled", order: toOrder(result.filled) });
      this.notify(result.filled.userId, { type: "position", event: "opened", position: toPosition(result.position) });
      this.notify(result.filled.userId, { type: "balance", balance: result.balance });
      this.track(this.progress.onPositionOpened(result.filled.userId));
    } finally {
      this.filling.delete(orderId);
    }
  }

  /** Отмена игроком или отклонение: резерв целиком возвращается на баланс */
  private async finishOrder(
    orderId: number,
    status: "cancelled" | "rejected",
    reason: string | null,
    userId?: number,
  ): Promise<Order> {
    const result = await this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
        .for("update");
      if (!order || (userId !== undefined && order.userId !== userId)) throw new TradeError("not_found");
      const user = await this.lockUser(tx, order.userId, true);
      return this.closeOrderRow(tx, order, user, status, reason);
    });
    this.pendingOrders.delete(orderId);
    return this.announceOrder(result.order, status, result.balance);
  }

  private async closeOrderRow(
    tx: Tx,
    order: OrderRow,
    user: UserRow,
    status: "cancelled" | "rejected",
    reason: string | null,
  ): Promise<{ order: OrderRow; balance: number }> {
    const balance = user.balance + order.reserved;
    await tx.update(users).set({ balance }).where(eq(users.id, order.userId));
    const [row] = await tx
      .update(orders)
      .set({ status, rejectReason: reason, updatedAt: new Date(this.now()) })
      .where(eq(orders.id, order.id))
      .returning();
    await tx.insert(ledger).values({
      userId: order.userId,
      type: "order_refund",
      amount: order.reserved,
      balanceAfter: balance,
      note: `order #${order.id} ${status}${reason ? `: ${reason}` : ""}`,
    });
    return { order: row!, balance };
  }

  private announceOrder(row: OrderRow, event: "cancelled" | "rejected", balance: number): Order {
    const order = toOrder(row);
    this.notify(row.userId, { type: "order", event, order });
    this.notify(row.userId, { type: "balance", balance });
    return order;
  }

  /** Опыт и квесты считаются после сделки и не задерживают ответ игроку */
  private track(task: Promise<void>): void {
    task.catch((err) => this.log(`Прогресс не обновлён: ${(err as Error).message}`));
  }

  private watchOrder(row: OrderRow): void {
    if (row.status !== "pending") {
      this.pendingOrders.delete(row.id);
      return;
    }
    this.pendingOrders.set(row.id, {
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      price: row.price,
    });
  }

  private watch(row: PositionRow): void {
    if (row.status !== "open") {
      this.watched.delete(row.id);
      return;
    }
    this.watched.set(row.id, {
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      side: row.side,
      liquidationPrice: row.liquidationPrice,
      takeProfit: row.takeProfit,
      stopLoss: row.stopLoss,
    });
  }

  private liveTicker(symbol: string): Ticker {
    const ticker = this.market.getTicker(symbol);
    if (this.market.stale || !ticker || !ticker.last) throw new TradeError("market_stale");
    return ticker;
  }

  private async getUser(userId: number): Promise<UserRow> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new TradeError("not_found");
    return user;
  }

  private async lockUser(tx: Tx, userId: number, allowBanned = false): Promise<UserRow> {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new TradeError("not_found");
    if (user.banned && !allowBanned) throw new TradeError("banned");
    return user;
  }

  private async getOwnOpen(userId: number, positionId: number): Promise<PositionRow> {
    const [row] = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.userId, userId), eq(positions.status, "open")));
    if (!row) throw new TradeError("not_found");
    return row;
  }

  private loanAvailable(user: UserRow): boolean {
    const s = this.settings.get();
    if (user.balance >= s.loanThreshold) return false;
    if ([...this.watched.values()].some((p) => p.userId === user.id)) return false;
    if ([...this.pendingOrders.values()].some((o) => o.userId === user.id)) return false;
    if (!user.lastLoanAt) return true;
    return this.now() - user.lastLoanAt.getTime() >= s.loanCooldownHours * 3600_000;
  }
}

function protectionValid(side: Side, price: number, liq: number, tp: number | null, sl: number | null): boolean {
  try {
    validateProtection(side, price, liq, tp, sl);
    return true;
  } catch {
    return false;
  }
}

/**
 * TP должен быть в сторону прибыли от текущей цены, SL — в сторону убытка,
 * но не дальше цены ликвидации (иначе он никогда не сработает).
 */
function validateProtection(side: Side, price: number, liq: number, tp: number | null, sl: number | null): void {
  if (tp != null) {
    const ok = Number.isFinite(tp) && tp > 0 && (side === "long" ? tp > price : tp < price);
    if (!ok) throw new TradeError("bad_take_profit");
  }
  if (sl != null) {
    const ok =
      Number.isFinite(sl) && sl > 0 && (side === "long" ? sl < price && sl > liq : sl > price && sl < liq);
    if (!ok) throw new TradeError("bad_stop_loss");
  }
}
