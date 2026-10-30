import { COINS, maxLeverageForLevel } from "@financio/shared";
import { useTranslation } from "react-i18next";
import { formatUsd } from "../lib/format";
import { rankKey } from "../lib/game";
import { useApp } from "../lib/store";

/** Поздравление с новым уровнем: бонус, новый ранг и что открылось */
export function LevelUpOverlay() {
  const { t } = useTranslation();
  const { levelUp, dismissLevelUp } = useApp();
  if (!levelUp) return null;
  const { level, bonus } = levelUp;
  const coins = COINS.filter((c) => c.minLevel === level).map((c) => c.base);
  const leverageUp = maxLeverageForLevel(level) > maxLeverageForLevel(level - 1);
  const rankUp = rankKey(level) !== rankKey(level - 1);

  return (
    <div className="overlay" onClick={dismissLevelUp}>
      <div className="overlay-card levelup" onClick={(e) => e.stopPropagation()}>
        <div className="levelup-badge mono">{level}</div>
        <div className="overlay-title">{t("levelUp.title", { level })}</div>
        {rankUp && <p>{t("levelUp.rank", { rank: t(`ranks.${rankKey(level)}`) })}</p>}
        {bonus > 0 && <p className="up mono">{t("levelUp.bonus", { amount: formatUsd(bonus) })}</p>}
        {coins.length > 0 && <p>{t("levelUp.coins", { coins: coins.join(", ") })}</p>}
        {leverageUp && <p>{t("levelUp.leverage", { max: maxLeverageForLevel(level) })}</p>}
        <button className="btn btn-brand" onClick={dismissLevelUp}>
          {t("levelUp.ok")}
        </button>
      </div>
    </div>
  );
}
