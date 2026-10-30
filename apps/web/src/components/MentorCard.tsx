import { useTranslation } from "react-i18next";
import { mentorTip } from "../lib/game";
import { useApp } from "../lib/store";
import { Logo } from "./Logo";

/** Наставник: одна самая важная реплика под текущее состояние игрока */
export function MentorCard() {
  const { t } = useTranslation();
  const { profile, open, history } = useApp();
  const tip = mentorTip(profile, open, history);
  const params = { ...tip.params, quest: tip.params?.quest ? t(`quests.${tip.params.quest}`) : "" };
  return (
    <section className={tip.tone === "warn" ? "card mentor warn" : "card mentor"}>
      <Logo size={30} />
      <div>
        <div className="mentor-name">{t("mentor.name")}</div>
        <div className="mentor-text">{t(`mentor.${tip.key}`, params)}</div>
      </div>
    </section>
  );
}
