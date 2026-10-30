import { useTranslation } from "react-i18next";
import { haptic } from "../lib/telegram";
import { useApp, type Tab } from "../lib/store";
import { Icon } from "./Icon";

const TABS: Tab[] = ["home", "trade", "portfolio", "rating", "profile"];
const ADMIN_TABS: Tab[] = [...TABS, "admin"];

export function TabBar() {
  const { t } = useTranslation();
  const { tab, setTab, open, isAdmin } = useApp();
  const tabs = isAdmin ? ADMIN_TABS : TABS;
  return (
    <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((id) => (
        <button
          key={id}
          className={id === tab ? "tab active" : "tab"}
          onClick={() => {
            haptic.tap();
            setTab(id);
          }}
        >
          <span className="tab-icon">
            <Icon name={id} size={22} />
            {id === "portfolio" && open.length > 0 && <span className="tab-badge">{open.length}</span>}
          </span>
          <span>{t(`tabs.${id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
