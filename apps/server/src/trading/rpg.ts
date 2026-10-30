import {
  computeEffects,
  getItem,
  getSkill,
  skillPointsForLevel,
  type Effects,
  type ItemSlot,
  type RpgState,
} from "@financio/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { ledger, userItems, userSkills, users } from "../db/schema.js";
import type { Notify } from "./engine.js";
import { TradeError } from "./errors.js";

/**
 * Экипировка и навыки. Бонусы игрока кешируются в памяти: торговый движок
 * спрашивает их на каждой сделке, а меняются они только здесь.
 */
export class RpgService {
  private readonly cache = new Map<number, Effects>();

  constructor(
    private readonly db: Db,
    private readonly notify: Notify,
  ) {}

  async effects(userId: number): Promise<Effects> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    return (await this.state(userId)).effects;
  }

  async state(userId: number): Promise<RpgState> {
    const [[user], items, skills] = await Promise.all([
      this.db.select({ level: users.level }).from(users).where(eq(users.id, userId)),
      this.db.select().from(userItems).where(eq(userItems.userId, userId)),
      this.db.select().from(userSkills).where(eq(userSkills.userId, userId)),
    ]);
    const equipped: Partial<Record<ItemSlot, string>> = {};
    for (const row of items) {
      const item = getItem(row.itemId);
      if (row.equipped && item) equipped[item.slot] = item.id;
    }
    const ranks = Object.fromEntries(skills.map((s) => [s.skillId, s.rank]));
    const spent = skills.reduce((sum, s) => sum + s.rank, 0);
    const effects = computeEffects(Object.values(equipped), ranks);
    this.cache.set(userId, effects);
    return {
      owned: items.map((i) => i.itemId),
      equipped,
      skills: ranks,
      skillPoints: Math.max(0, skillPointsForLevel(user?.level ?? 1) - spent),
      effects,
    };
  }

  /** Покупка за игровые деньги; вещь сразу надевается, если слот пуст */
  async buy(userId: number, itemId: string): Promise<RpgState> {
    const item = getItem(itemId);
    if (!item) throw new TradeError("unknown_item");
    const balance = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new TradeError("not_found");
      if (user.banned) throw new TradeError("banned");
      if (user.level < item.minLevel) throw new TradeError("item_locked");
      const owned = await tx.select().from(userItems).where(eq(userItems.userId, userId));
      if (owned.some((o) => o.itemId === itemId)) throw new TradeError("already_owned");
      if (user.balance < item.price) throw new TradeError("insufficient_balance");
      const slotTaken = owned.some((o) => o.equipped && getItem(o.itemId)?.slot === item.slot);
      const balance = user.balance - item.price;
      await tx.update(users).set({ balance }).where(eq(users.id, userId));
      await tx.insert(userItems).values({ userId, itemId, equipped: !slotTaken });
      await tx.insert(ledger).values({
        userId,
        type: "shop_purchase",
        amount: -item.price,
        balanceAfter: balance,
        note: itemId,
      });
      return balance;
    });
    this.notify(userId, { type: "balance", balance });
    return this.changed(userId);
  }

  /** Надевает вещь и снимает другую из того же слота */
  async equip(userId: number, itemId: string): Promise<RpgState> {
    const item = getItem(itemId);
    if (!item) throw new TradeError("unknown_item");
    await this.db.transaction(async (tx) => {
      const owned = await tx.select().from(userItems).where(eq(userItems.userId, userId)).for("update");
      if (!owned.some((o) => o.itemId === itemId)) throw new TradeError("item_not_owned");
      for (const o of owned) {
        if (o.itemId !== itemId && o.equipped && getItem(o.itemId)?.slot === item.slot) {
          await tx
            .update(userItems)
            .set({ equipped: false })
            .where(and(eq(userItems.userId, userId), eq(userItems.itemId, o.itemId)));
        }
      }
      await tx
        .update(userItems)
        .set({ equipped: true })
        .where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)));
    });
    return this.changed(userId);
  }

  async unequip(userId: number, itemId: string): Promise<RpgState> {
    const [row] = await this.db
      .update(userItems)
      .set({ equipped: false })
      .where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)))
      .returning();
    if (!row) throw new TradeError("item_not_owned");
    return this.changed(userId);
  }

  /** Повышает ранг навыка за одно очко */
  async upgradeSkill(userId: number, skillId: string): Promise<RpgState> {
    const skill = getSkill(skillId);
    if (!skill) throw new TradeError("unknown_skill");
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!user) throw new TradeError("not_found");
      if (user.level < skill.minLevel) throw new TradeError("skill_locked");
      const skills = await tx.select().from(userSkills).where(eq(userSkills.userId, userId));
      const spent = skills.reduce((sum, s) => sum + s.rank, 0);
      if (spent >= skillPointsForLevel(user.level)) throw new TradeError("no_skill_points");
      const current = skills.find((s) => s.skillId === skillId)?.rank ?? 0;
      if (current >= skill.maxRank) throw new TradeError("skill_maxed");
      await tx
        .insert(userSkills)
        .values({ userId, skillId, rank: current + 1 })
        .onConflictDoUpdate({ target: [userSkills.userId, userSkills.skillId], set: { rank: current + 1 } });
    });
    return this.changed(userId);
  }

  /** Сбрасывает кеш, пересчитывает бонусы и сообщает клиенту */
  private async changed(userId: number): Promise<RpgState> {
    this.cache.delete(userId);
    const state = await this.state(userId);
    this.notify(userId, { type: "rpg", state });
    return state;
  }
}
