import { describe, expect, it } from "vitest";
import { computeEffects, ITEM_SLOTS, ITEMS, SKILLS, skillPointsForLevel } from "./rpg.js";

describe("RPG", () => {
  it("складывает эффекты вещей и рангов навыков", () => {
    const e = computeEffects(["second_monitor", "office_chair"], { discipline: 2, analyst: 1 });
    expect(e.feeDiscount).toBeCloseTo(0.05 + 0.06);
    expect(e.xpBonus).toBeCloseTo(0.05 + 0.05);
    expect(e.slippageReduction).toBe(0);
  });

  it("не даёт превысить потолки и ранги", () => {
    const e = computeEffects(["pro_terminal"], { scalper: 10 });
    expect(e.slippageReduction).toBe(0.9);
    expect(computeEffects([], { scalper: 10 }).slippageReduction).toBeCloseTo(0.45);
    expect(computeEffects(["pro_terminal", "macro_pad", "mech_keyboard"], { scalper: 3 }).slippageReduction).toBe(0.9);
  });

  it("каталоги без дублей id", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    // В каждом слоте есть вещь с первых уровней и легендарная на потом
    for (const slot of ITEM_SLOTS) {
      const items = ITEMS.filter((i) => i.slot === slot);
      expect(Math.min(...items.map((i) => i.minLevel))).toBeLessThanOrEqual(3);
      expect(items.some((i) => i.rarity === "legendary")).toBe(true);
    }
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
    expect(skillPointsForLevel(1)).toBe(0);
    expect(skillPointsForLevel(5)).toBe(4);
  });
});
