import { useTranslation } from "react-i18next";
import { useApp } from "../lib/store";

/** Уведомление внизу экрана о событиях, которые случились без участия игрока */
export function GlobalToast() {
  const { t } = useTranslation();
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  const p = toast.params ?? {};
  const text = t(toast.key, {
    ...p,
    type: p.type ? t(`orders.types.${p.type}`) : "",
    side: p.side ? t(`trade.${p.side}`) : "",
    reason: p.reason ? t(`errors.${p.reason}`) : "",
    quest: p.quest ? t(`quests.${p.quest}`) : "",
  });
  return <div className={toast.error ? "toast error floating" : "toast floating"}>{text}</div>;
}
