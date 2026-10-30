import { DEFAULT_SETTINGS, type GameSettings } from "@financio/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { settings } from "../db/schema.js";

const KEY = "game";

export const settingsSchema = z.object({
  tradingEnabled: z.boolean(),
  takerFeeRate: z.number().min(0).max(0.01),
  startingBalance: z.number().positive().max(1e9),
  maxOpenPositions: z.number().int().min(1).max(100),
  loanAmount: z.number().positive().max(1e9),
  loanThreshold: z.number().min(0).max(1e9),
  loanCooldownHours: z.number().min(0).max(24 * 30),
});

/** Настройки игры в базе с кэшем в памяти */
export class SettingsStore {
  private current: GameSettings = { ...DEFAULT_SETTINGS };

  constructor(private readonly db: Db) {}

  async load(): Promise<GameSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
    const parsed = settingsSchema.partial().safeParse(row?.value ?? {});
    this.current = { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
    return this.get();
  }

  get(): GameSettings {
    return { ...this.current };
  }

  async update(patch: Partial<GameSettings>): Promise<GameSettings> {
    const next = settingsSchema.parse({ ...this.current, ...patch });
    await this.db
      .insert(settings)
      .values({ key: KEY, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    this.current = next;
    return this.get();
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    return row?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
}
