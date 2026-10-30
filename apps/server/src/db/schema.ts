import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  /** Telegram ID игрока */
  id: bigint("id", { mode: "number" }).primaryKey(),
  firstName: text("first_name").notNull(),
  username: text("username"),
  languageCode: text("language_code"),
  balance: doublePrecision("balance").notNull(),
  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  banned: boolean("banned").notNull().default(false),
  lastLoanAt: timestamp("last_loan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["long", "short"] }).notNull(),
    status: text("status", { enum: ["open", "closed", "liquidated"] }).notNull().default("open"),
    leverage: integer("leverage").notNull(),
    margin: doublePrecision("margin").notNull(),
    invested: doublePrecision("invested").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    liquidationPrice: doublePrecision("liquidation_price").notNull(),
    takeProfit: doublePrecision("take_profit"),
    stopLoss: doublePrecision("stop_loss"),
    openFee: doublePrecision("open_fee").notNull(),
    closeFee: doublePrecision("close_fee").notNull().default(0),
    fundingPaid: doublePrecision("funding_paid").notNull().default(0),
    exitPrice: doublePrecision("exit_price"),
    realizedPnl: doublePrecision("realized_pnl"),
    closeReason: text("close_reason", {
      enum: ["manual", "take_profit", "stop_loss", "liquidation", "admin"],
    }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("positions_user_status_idx").on(t.userId, t.status), index("positions_status_idx").on(t.status)],
);

/** Отложенные ордера (лимит и стоп): деньги зарезервированы с баланса до исполнения или отмены */
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["long", "short"] }).notNull(),
    type: text("type", { enum: ["limit", "stop"] }).notNull(),
    status: text("status", { enum: ["pending", "filled", "cancelled", "rejected"] }).notNull().default("pending"),
    price: doublePrecision("price").notNull(),
    margin: doublePrecision("margin").notNull(),
    leverage: integer("leverage").notNull(),
    takeProfit: doublePrecision("take_profit"),
    stopLoss: doublePrecision("stop_loss"),
    reserved: doublePrecision("reserved").notNull(),
    positionId: integer("position_id"),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_user_status_idx").on(t.userId, t.status), index("orders_status_idx").on(t.status)],
);

/** Выполненные квесты дня: награда начисляется один раз за сутки (UTC) */
export const questClaims = pgTable(
  "quest_claims",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    /** Начало суток UTC, мс */
    day: bigint("day", { mode: "number" }).notNull(),
    questId: text("quest_id").notNull(),
    xp: integer("xp").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.questId] })],
);

/** Купленная экипировка; equipped — надета ли (одна вещь на слот) */
export const userItems = pgTable(
  "user_items",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    itemId: text("item_id").notNull(),
    equipped: boolean("equipped").notNull().default(false),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

/** Ранги навыков игрока */
export const userSkills = pgTable(
  "user_skills",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    skillId: text("skill_id").notNull(),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

/** Журнал всех изменений баланса и маржи: для разбора спорных случаев и откатов */
export const ledger = pgTable(
  "ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    type: text("type", {
      enum: [
        "start",
        "open",
        "close",
        "add_margin",
        "funding",
        "loan",
        "admin_adjust",
        "order_reserve",
        "order_refund",
        "level_bonus",
        "shop_purchase",
      ],
    }).notNull(),
    amount: doublePrecision("amount").notNull(),
    balanceAfter: doublePrecision("balance_after").notNull(),
    positionId: integer("position_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
