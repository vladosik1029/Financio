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
  maxLeverageForLevel,
  MIN_LEVERAGE,
  stopLossHit,
  takeProfitHit,
  unrealizedPnl,
  type CloseReason,
  type OpenPositionRequest,
  type Position,
  type Profile,
  type ServerMessage,
  type Side,
  type Ticker,
  type TradeErrorCode,
} from "@financio/shared";
import { and, count, desc, eq, ne } from "drizzle-orm";
import type { TelegramUser } from "../auth/telegram.js";
import type { Db } from "../db/index.js";
import { ledger, positions, users, type PositionRow, type UserRow } from "../db/schema.js";
import { toPosition } from "./mappers.js";
import type { SettingsStore } from "./settings.js";

export class TradeError extends Error {
  constructor(readonly code: TradeErrorCode) {
    super(code);
  }
}

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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const FUNDING_SLOT_KEY = "funding_slot";

/**
 * Серверный торговый движок: все деньги, цены исполнения, ликвидации и funding
 * считаются только здесь. Клиент лишь показывает результат.
 */
export class TradingEngine {
  private readonly watched = new Map<number, WatchedPosition>();
  private readonly closing = new Set<number>();

  constructor(
    private readonly db: Db,
    private readonly market: MarketView,
    private readonly settings: SettingsStore,
    private readonly notify: Notify = () => {},
    private readonly now: () => number = Date.now,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Загружает открытые позиции в память после старта сервера */
  async init(): Promise<void> {
    await this.settings.load();
    const rows = await this.db.select().from(positions).where(eq(positions.status, "open"));
    for (const row of rows) this.watch(row);
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
    return {
      level: user.level,
      xp: user.xp,
      xpToNext: user.level * 100,
      balance: user.balance,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: maxLeverageForLevel(user.level),
      maxOpenPositions: s.maxOpenPositions,
      takerFeeRate: s.takerFeeRate,
      canTakeLoan: this.loanAvailable(user),
      loanAmount: s.loanAmount,
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

  async openPosition(userId: number, req: OpenPositionRequest): Promise<Position> {
    const s = this.settings.get();
    if (!s.tradingEnabled) throw new TradeError("trading_disabled");
    const coin = getCoin(req.symbol);
    if (!coin) throw new TradeError("unknown_symbol");
    const ticker = this.liveTicker(req.symbol);
    if (req.side !== "long" && req.side !== "short") throw new TradeError("bad_leverage");
    if (!Number.isFinite(req.margin) || req.margin < 1) throw new TradeError("bad_margin");

    const { row, balance } = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!isCoinUnlocked(coin, user.level)) throw new TradeError("coin_locked");
      if (!checkLeverage(req.leverage, user.level).ok) throw new TradeError("bad_leverage");

      const [open] = await tx
        .select({ n: count() })
        .from(positions)
        .where(and(eq(positions.userId, userId), eq(positions.status, "open")));
      if ((open?.n ?? 0) >= s.maxOpenPositions) throw new TradeError("too_many_positions");

      const notional = req.margin * req.leverage;
      const entry = fillPrice(req.side, "open", ticker.last, notional);
      const quantity = notional / entry;
      const fee = notional * s.takerFeeRate;
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
    return position;
  }

  /** Закрытие игроком по рынку */
  async closePosition(userId: number, positionId: number): Promise<Position> {
    const row = await this.getOwnOpen(userId, positionId);
    const ticker = this.liveTicker(row.symbol);
    const exit = fillPrice(row.side, "close", ticker.last, row.quantity * ticker.last);
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
    const balance = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!this.loanAvailable(user)) throw new TradeError("loan_unavailable");
      const balance = user.balance + s.loanAmount;
      await tx.update(users).set({ balance, lastLoanAt: new Date(this.now()) }).where(eq(users.id, userId));
      await tx.insert(ledger).values({ userId, type: "loan", amount: s.loanAmount, balanceAfter: balance });
      return balance;
    });
    this.notify(userId, { type: "balance", balance });
    return balance;
  }

  // ---------- Рынок ----------

  /** Проверка ликвидаций и TP/SL на каждом обновлении mark price */
  onMark(symbol: string, mark: number): void {
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
          closeFee = pos.quantity * exitPrice * s.takerFeeRate;
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
    if (!user.lastLoanAt) return true;
    return this.now() - user.lastLoanAt.getTime() >= s.loanCooldownHours * 3600_000;
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
