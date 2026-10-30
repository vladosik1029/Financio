import { describe, expect, it } from "vitest";
import { addXp, dailyQuests, QUEST_POOL, tradeXp } from "./progress.js";

const base = { openedAt: 0, closedAt: 60_000, invested: 100, closeReason: "manual" as const };

describe("опыт", () => {
  it("за сделку зависит от результата", () => {
    expect(tradeXp({ ...base, realizedPnl: -10 })).toBe(5);
    expect(tradeXp({ ...base, realizedPnl: 10 })).toBe(20);
    expect(tradeXp({ ...base, realizedPnl: 500 })).toBe(50);
    expect(tradeXp({ ...base, realizedPnl: -100, closeReason: "liquidation" })).toBe(1);
  });

  it("слишком короткая сделка опыта не даёт", () => {
    expect(tradeXp({ ...base, closedAt: 5_000, realizedPnl: 50 })).toBe(0);
  });

  it("поднимает уровень и переносит остаток", () => {
    expect(addXp(1, 90, 30)).toEqual({ level: 2, xp: 20, levelsGained: [2] });
    expect(addXp(1, 0, 350)).toEqual({ level: 3, xp: 50, levelsGained: [2, 3] });
    expect(addXp(4, 10, 5)).toEqual({ level: 4, xp: 15, levelsGained: [] });
  });
});

describe("квесты дня", () => {
  const day = Date.UTC(2026, 9, 30);

  it("одни и те же в течение суток UTC, по одному из каждой группы", () => {
    const morning = dailyQuests(day + 1000);
    expect(dailyQuests(day + 86_399_000)).toEqual(morning);
    expect(morning).toHaveLength(QUEST_POOL.length);
    morning.forEach((q, i) => expect(QUEST_POOL[i]).toContain(q));
  });

  it("сменяются от дня к дню", () => {
    const sets = new Set(Array.from({ length: 30 }, (_, i) => dailyQuests(day + i * 86_400_000).map((q) => q.id).join()));
    expect(sets.size).toBeGreaterThan(10);
  });
});
