import { useEffect } from "react";
import { AlertOverlay } from "./components/AlertOverlay";
import { GlobalToast } from "./components/GlobalToast";
import { LevelUpOverlay } from "./components/LevelUpOverlay";
import { TabBar } from "./components/TabBar";
import { useApp } from "./lib/store";
import { tg } from "./lib/telegram";
import { AdminScreen } from "./screens/AdminScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { CareerScreen } from "./screens/CareerScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { TradeScreen } from "./screens/TradeScreen";

export function App() {
  const tab = useApp((s) => s.tab);
  const isAdmin = useApp((s) => s.isAdmin);

  useEffect(() => {
    const tgName = tg?.initDataUnsafe.user?.first_name;
    if (tgName) useApp.setState({ name: tgName });
    void useApp.getState().refresh();
  }, []);

  return (
    <div className="app">
      <main className="content">
        {tab === "home" && <HomeScreen />}
        {tab === "trade" && <TradeScreen />}
        {tab === "portfolio" && <PortfolioScreen />}
        {tab === "career" && <CareerScreen />}
        {tab === "profile" && <ProfileScreen />}
        {tab === "admin" && isAdmin && <AdminScreen />}
      </main>
      <TabBar />
      <GlobalToast />
      <AlertOverlay />
      <LevelUpOverlay />
    </div>
  );
}
