import { useEffect } from "react";
import { Hud } from "./components/Hud";
import { TabBar } from "./components/TabBar";
import { api } from "./lib/api";
import { useApp } from "./lib/store";
import { tg } from "./lib/telegram";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { TradeScreen } from "./screens/TradeScreen";

export function App() {
  const tab = useApp((s) => s.tab);

  useEffect(() => {
    const tgName = tg?.initDataUnsafe.user?.first_name;
    if (tgName) useApp.setState({ name: tgName });
    api
      .me()
      .then(({ user, profile }) => useApp.setState({ name: user.first_name, profile }))
      .catch(() => {
        // Без Telegram (или без бэкенда) остаёмся на стартовом профиле
      });
  }, []);

  return (
    <div className="app">
      <Hud />
      <main className="content">
        {tab === "trade" && <TradeScreen />}
        {tab === "portfolio" && <PlaceholderScreen section="portfolio" />}
        {tab === "career" && <PlaceholderScreen section="career" />}
        {tab === "rating" && <PlaceholderScreen section="rating" />}
        {tab === "profile" && <ProfileScreen />}
      </main>
      <TabBar />
    </div>
  );
}
