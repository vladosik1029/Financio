import { getItem, ITEM_SLOTS, ITEMS, SKILLS, type ItemDef, type SkillDef } from "@financio/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { LeaderboardView } from "../components/LeaderboardView";
import { ApiError, api } from "../lib/api";
import { formatUsd } from "../lib/format";
import { effectLines } from "../lib/game";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

type View = "gear" | "skills" | "rating";

/** Общий обработчик действий магазина: ошибки показываем тостом */
function useAction() {
  const { applyRpg, showToast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, action: () => Promise<{ rpg: Parameters<typeof applyRpg>[0] }>, success?: () => void) => {
    if (busy) return;
    setBusy(id);
    haptic.tap();
    try {
      const { rpg } = await action();
      applyRpg(rpg);
      haptic.success();
      success?.();
    } catch (e) {
      haptic.error();
      showToast({ key: `errors.${e instanceof ApiError ? e.code : "internal"}`, error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function Effects({ effects, times }: { effects: ItemDef["effects"]; times?: number }) {
  const { t } = useTranslation();
  return (
    <div className="effect-list">
      {effectLines(effects, times).map((l) => (
        <span key={l.key} className="effect">
          {t(l.key, { v: l.v })}
        </span>
      ))}
    </div>
  );
}

/** Карьера трейдера: экипировка за игровые деньги, навыки за очки уровня */
export function CareerScreen() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("gear");
  const rpg = useApp((s) => s.profile.rpg);
  const bonuses = effectLines(rpg.effects);

  return (
    <div className="screen career">
      <h2 className="section-title">{t("tabs.career")}</h2>
      <section className="card">
        <div className="muted small">{t("career.bonuses")}</div>
        {bonuses.length === 0 ? (
          <p className="muted small">{t("career.noBonuses")}</p>
        ) : (
          <div className="effect-list">
            {bonuses.map((l) => (
              <span key={l.key} className="effect">
                {t(l.key, { v: l.v })}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="segment">
        {(["gear", "skills", "rating"] as const).map((id) => (
          <button key={id} className={view === id ? "seg active" : "seg"} onClick={() => setView(id)}>
            {t(`career.${id}`)}
          </button>
        ))}
      </div>

      {view === "gear" && <Gear />}
      {view === "skills" && <Skills />}
      {view === "rating" && <LeaderboardView />}
    </div>
  );
}

function Gear() {
  const { t } = useTranslation();
  const { profile, showToast } = useApp();
  const { rpg, level, balance } = profile;
  const { busy, run } = useAction();

  return (
    <>
      <div className="section-title">{t("career.workplace")}</div>
      <div className="slots">
        {ITEM_SLOTS.map((slot) => {
          const item = getItem(rpg.equipped[slot] ?? "");
          return (
            <div key={slot} className={`slot ${item ? `rarity-${item.rarity}` : "empty"}`}>
              <div className="muted small">{t(`slots.${slot}`)}</div>
              <div className="slot-item">{item ? t(`items.${item.id}.name`) : t("career.emptySlot")}</div>
            </div>
          );
        })}
      </div>

      <div className="section-title">{t("career.shop")}</div>
      {ITEM_SLOTS.map((slot) => (
        <div key={slot} className="shop-group">
          <div className="muted small shop-slot">{t(`slots.${slot}`)}</div>
          {ITEMS.filter((i) => i.slot === slot).map((item) => {
            const owned = rpg.owned.includes(item.id);
            const equipped = rpg.equipped[slot] === item.id;
            const locked = level < item.minLevel;
            return (
              <div key={item.id} className={`card shop-item rarity-${item.rarity}${locked ? " locked" : ""}`}>
                <div className="shop-main">
                  <div className="shop-name">
                    {t(`items.${item.id}.name`)} <span className="rarity">{t(`rarity.${item.rarity}`)}</span>
                  </div>
                  <div className="muted small">{t(`items.${item.id}.desc`)}</div>
                  <Effects effects={item.effects} />
                </div>
                <div className="shop-action">
                  {equipped ? (
                    <button className="chip" disabled={!!busy} onClick={() => run(item.id, () => api.unequip(item.id))}>
                      <Icon name="check" size={14} /> {t("career.equipped")}
                    </button>
                  ) : owned ? (
                    <button className="chip active" disabled={!!busy} onClick={() => run(item.id, () => api.equip(item.id))}>
                      {t("career.equip")}
                    </button>
                  ) : locked ? (
                    <span className="pill">
                      <Icon name="lock" size={12} /> {t("career.fromLevel", { level: item.minLevel })}
                    </span>
                  ) : (
                    <button
                      className="chip active"
                      disabled={!!busy || balance < item.price}
                      onClick={() =>
                        run(
                          item.id,
                          () => api.buyItem(item.id),
                          () => showToast({ key: "career.bought", params: { item: t(`items.${item.id}.name`) } }),
                        )
                      }
                    >
                      {t("career.buy")} · <span className="mono">{formatUsd(item.price)}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Skills() {
  const { t } = useTranslation();
  const { profile, showToast } = useApp();
  const { rpg, level } = profile;
  const { busy, run } = useAction();

  const upgrade = (skill: SkillDef) =>
    run(
      skill.id,
      () => api.upgradeSkill(skill.id),
      () =>
        showToast({
          key: "career.upgraded",
          params: { skill: t(`skillNames.${skill.id}.name`), rank: (rpg.skills[skill.id] ?? 0) + 1 },
        }),
    );

  return (
    <>
      <section className="card skill-points">
        <div>
          <b>{t("career.points", { n: rpg.skillPoints })}</b>
          <div className="muted small">{t("career.pointsHint")}</div>
        </div>
      </section>
      {SKILLS.map((skill) => {
        const rank = rpg.skills[skill.id] ?? 0;
        const locked = level < skill.minLevel;
        const maxed = rank >= skill.maxRank;
        return (
          <div key={skill.id} className={`card skill${locked ? " locked" : ""}`}>
            <div className="shop-main">
              <div className="shop-name">{t(`skillNames.${skill.id}.name`)}</div>
              <div className="muted small">{t(`skillNames.${skill.id}.desc`)}</div>
              <div className="skill-row">
                <div className="pips">
                  {Array.from({ length: skill.maxRank }, (_, i) => (
                    <span key={i} className={i < rank ? "pip on" : "pip"} />
                  ))}
                </div>
                <Effects effects={skill.perRank} />
              </div>
            </div>
            <div className="shop-action">
              {locked ? (
                <span className="pill">
                  <Icon name="lock" size={12} /> {t("career.fromLevel", { level: skill.minLevel })}
                </span>
              ) : maxed ? (
                <span className="pill pill-brand">{t("career.rank", { rank, max: skill.maxRank })}</span>
              ) : (
                <button
                  className="skill-up"
                  aria-label="+"
                  disabled={!!busy || rpg.skillPoints <= 0}
                  onClick={() => upgrade(skill)}
                >
                  <Icon name="plus" size={18} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
