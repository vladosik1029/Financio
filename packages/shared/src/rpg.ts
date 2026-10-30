/**
 * RPG-слой: экипировка за игровые деньги и навыки за очки уровня.
 * И то и другое даёт эффекты, которые сервер применяет к торговле.
 * Новые предметы и навыки добавляются только в каталоги ниже.
 */

/** Бонусы игрока: всё в долях, кроме extraPositions */
export interface Effects {
  /** Скидка на торговые комиссии */
  feeDiscount: number;
  /** Прибавка к опыту за сделки и квесты */
  xpBonus: number;
  /** Снижение проскальзывания рыночных ордеров */
  slippageReduction: number;
  /** Прибавка к кредиту наставника */
  loanBonus: number;
  /** Дополнительные слоты под позиции и ордера */
  extraPositions: number;
}

export type EffectKey = keyof Effects;

export const NO_EFFECTS: Effects = {
  feeDiscount: 0,
  xpBonus: 0,
  slippageReduction: 0,
  loanBonus: 0,
  extraPositions: 0,
};

/** Потолки, чтобы сочетание вещей и навыков не ломало экономику */
export const EFFECT_CAPS: Effects = {
  feeDiscount: 0.5,
  xpBonus: 1,
  slippageReduction: 0.9,
  loanBonus: 1,
  extraPositions: 10,
};

export type ItemSlot = "monitor" | "chair" | "keyboard" | "talisman";
export const ITEM_SLOTS: readonly ItemSlot[] = ["monitor", "chair", "keyboard", "talisman"];

export type Rarity = "common" | "rare" | "epic";

export interface ItemDef {
  id: string;
  slot: ItemSlot;
  rarity: Rarity;
  price: number;
  minLevel: number;
  effects: Partial<Effects>;
}

/** Каталог магазина. Название и описание — в переводах items.<id> */
export const ITEMS: readonly ItemDef[] = [
  { id: "second_monitor", slot: "monitor", rarity: "common", price: 300, minLevel: 1, effects: { feeDiscount: 0.05 } },
  { id: "ultrawide", slot: "monitor", rarity: "rare", price: 1500, minLevel: 5, effects: { feeDiscount: 0.1 } },
  { id: "trading_wall", slot: "monitor", rarity: "epic", price: 6000, minLevel: 15, effects: { feeDiscount: 0.2, xpBonus: 0.05 } },
  { id: "office_chair", slot: "chair", rarity: "common", price: 200, minLevel: 1, effects: { xpBonus: 0.05 } },
  { id: "gaming_chair", slot: "chair", rarity: "rare", price: 1200, minLevel: 4, effects: { xpBonus: 0.1 } },
  { id: "pilot_chair", slot: "chair", rarity: "epic", price: 4000, minLevel: 10, effects: { xpBonus: 0.2 } },
  { id: "mech_keyboard", slot: "keyboard", rarity: "common", price: 500, minLevel: 3, effects: { slippageReduction: 0.25 } },
  { id: "macro_pad", slot: "keyboard", rarity: "rare", price: 1800, minLevel: 6, effects: { slippageReduction: 0.45 } },
  { id: "pro_terminal", slot: "keyboard", rarity: "epic", price: 5000, minLevel: 12, effects: { slippageReduction: 0.6, feeDiscount: 0.05 } },
  { id: "lucky_coin", slot: "talisman", rarity: "common", price: 400, minLevel: 2, effects: { loanBonus: 0.2 } },
  { id: "bull_figurine", slot: "talisman", rarity: "rare", price: 2500, minLevel: 8, effects: { extraPositions: 2 } },
  { id: "golden_bull", slot: "talisman", rarity: "epic", price: 7500, minLevel: 18, effects: { extraPositions: 3, xpBonus: 0.1 } },
];

export interface SkillDef {
  id: string;
  maxRank: number;
  minLevel: number;
  /** Эффект за каждый ранг */
  perRank: Partial<Effects>;
}

/** Навыки: каждый ранг стоит одно очко. Название и описание — в переводах skills.<id> */
export const SKILLS: readonly SkillDef[] = [
  { id: "discipline", maxRank: 3, minLevel: 1, perRank: { feeDiscount: 0.03 } },
  { id: "analyst", maxRank: 3, minLevel: 1, perRank: { xpBonus: 0.05 } },
  { id: "scalper", maxRank: 3, minLevel: 3, perRank: { slippageReduction: 0.15 } },
  { id: "connections", maxRank: 3, minLevel: 2, perRank: { loanBonus: 0.1 } },
  { id: "risk_manager", maxRank: 2, minLevel: 5, perRank: { extraPositions: 1 } },
];

export function getItem(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}

export function getSkill(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** Очки навыков: одно за каждый уровень после первого */
export function skillPointsForLevel(level: number): number {
  return Math.max(0, level - 1);
}

/** Сумма эффектов надетых вещей и навыков с учётом потолков */
export function computeEffects(equipped: readonly string[], skillRanks: Readonly<Record<string, number>>): Effects {
  const total: Effects = { ...NO_EFFECTS };
  const add = (e: Partial<Effects>, times = 1) => {
    for (const key of Object.keys(e) as EffectKey[]) total[key] += (e[key] ?? 0) * times;
  };
  for (const id of equipped) {
    const item = getItem(id);
    if (item) add(item.effects);
  }
  for (const [id, rank] of Object.entries(skillRanks)) {
    const skill = getSkill(id);
    if (skill) add(skill.perRank, Math.min(rank, skill.maxRank));
  }
  for (const key of Object.keys(total) as EffectKey[]) total[key] = Math.min(total[key], EFFECT_CAPS[key]);
  return total;
}

/** Состояние RPG игрока для клиента */
export interface RpgState {
  /** Купленные предметы */
  owned: string[];
  /** Надетые предметы по слотам */
  equipped: Partial<Record<ItemSlot, string>>;
  skills: Record<string, number>;
  skillPoints: number;
  effects: Effects;
}
