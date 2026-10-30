import { useTranslation } from "react-i18next";
import { haptic } from "../lib/telegram";
import { useApp, type Tab } from "../lib/store";

const TABS: { id: Tab; icon: string }[] = [
  { id: "trade", icon: "📈" },
  { id: "portfolio", icon: "💼" },
  { id: "career", icon: "⭐" },
  { id: "rating", icon: "🏆" },
  { id: "profile", icon: "👤" },
];

export function TabBar() {
  const { t } = useTranslation();
  const { tab, setTab } = useApp();
  return (
    <nav className="tabbar">
      {TABS.map((item) => (
        <button
          key={item.id}
          className={item.id === tab ? "tab active" : "tab"}
          onClick={() => {
            haptic.tap();
            setTab(item.id);
          }}
        >
          <span className="tab-icon">{item.icon}</span>
          <span>{t(`tabs.${item.id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
