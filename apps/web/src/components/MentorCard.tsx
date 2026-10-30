import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey } from "../lib/format";
import { mentorTip } from "../lib/game";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";
import { clock, useNow } from "../lib/useNow";
import { Logo } from "./Logo";

/** Наставник: одна самая важная реплика под текущее состояние игрока */
export function MentorCard() {
  const { t } = useTranslation();
  const { profile, open, history, refresh, showToast } = useApp();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const tip = mentorTip(profile, open, history);
  const params = {
    ...tip.params,
    quest: tip.params?.quest ? t(`quests.${tip.params.quest}`) : "",
    time: profile.tilt.breakUntil ? clock(profile.tilt.breakUntil - now) : "",
  };
  // Перерыв закончился, пока экран открыт: подтягиваем профиль, чтобы появилась кнопка награды
  const breakOver = profile.tilt.breakUntil !== null && profile.tilt.breakUntil <= now;
  useEffect(() => {
    if (!breakOver) return;
    // Часы телефона могут спешить относительно сервера: спрашиваем, пока сервер не подтвердит
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [breakOver, refresh]);

  const act = async () => {
    setBusy(true);
    haptic.tap();
    try {
      await (tip.action === "break" ? api.startBreak() : api.claimBreak());
      haptic.success();
      await refresh();
    } catch (err) {
      haptic.error();
      showToast({ key: errorKey(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={tip.tone === "warn" ? "card mentor warn" : "card mentor"}>
      <Logo size={30} />
      <div className="mentor-body">
        <div className="mentor-name">{t("mentor.name")}</div>
        <div className="mentor-text">{t(`mentor.${tip.key}`, params)}</div>
        {tip.action && (
          <button className="btn btn-gold mentor-action" disabled={busy} onClick={act}>
            {t(tip.action === "break" ? "tilt.takeBreak" : "tilt.claim")}
          </button>
        )}
      </div>
    </section>
  );
}
