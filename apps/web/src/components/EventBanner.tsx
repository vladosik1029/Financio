import { currentOrNextEvent, EVENT_BONUS_XP, EVENT_FEE_DISCOUNT, EVENT_XP_MULTIPLIER, getCoin } from "@financio/shared";
import { useTranslation } from "react-i18next";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";
import { clock, useNow } from "../lib/useNow";

/**
 * Рыночное событие от NPC: идёт сейчас — яркий баннер с таймером и переходом к монете,
 * скоро — тихая строка с обратным отсчётом (только в полном виде).
 */
export function EventBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { setSymbol, setTab, tab } = useApp();
  const now = useNow(1000);
  // Расписание событий одно на всех и считается от времени, сервер нужен только для применения
  const event = currentOrNextEvent(now);
  const coin = getCoin(event.symbol)?.base ?? event.symbol;
  const live = now >= event.startsAt;
  if (!live && compact) return null;

  const effect = t(`events.kinds.${event.kind}`, {
    coin,
    x: EVENT_XP_MULTIPLIER,
    pct: EVENT_FEE_DISCOUNT * 100,
    xp: EVENT_BONUS_XP,
  });

  if (!live) {
    return (
      <div className="event-next muted small">
        {t("events.next", { time: clock(event.startsAt - now) })}
      </div>
    );
  }
  return (
    <button
      className="event-banner"
      onClick={() => {
        haptic.tap();
        setSymbol(event.symbol);
        if (tab !== "trade") setTab("trade");
      }}
    >
      <div className="event-head">
        <b>{t(`events.${event.id}.title`)}</b>
        <span className="mono small">{clock(event.endsAt - now)}</span>
      </div>
      {!compact && <div className="small">{t(`events.${event.id}.text`, { coin })}</div>}
      <div className="event-effect small">{effect}</div>
    </button>
  );
}
