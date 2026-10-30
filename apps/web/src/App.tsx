import { useEffect } from "react";
import { AlertOverlay } from "./components/AlertOverlay";
import { Hud } from "./components/Hud";
import { TabBar } from "./components/TabBar";
import { useApp } from "./lib/store";
import { tg } from "./lib/telegram";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { TradeScreen } from "./screens/TradeScreen";

export function App() {
  const tab = useApp((s) => s.tab);

  useEffect(() => {
    const tgName = tg?.initDataUnsafe.user?.first_name;
    if (tgName) useApp.setState({ name: tgName });
    void useApp.getState().refresh();
  }, []);

  return (
    <div className="app">
      <Hud />
      <main className="content">
        {tab === "trade" && <TradeScreen />}
        {tab === "portfolio" && <PortfolioScreen />}
        {tab === "career" && <PlaceholderScreen section="career" />}
        {tab === "rating" && <PlaceholderScreen section="rating" />}
        {tab === "profile" && <ProfileScreen />}
      </main>
      <TabBar />
      <AlertOverlay />
    </div>
  );
}
