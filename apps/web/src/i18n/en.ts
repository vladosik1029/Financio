import type { Messages } from "./ru";

export const en: Messages = {
  tabs: { trade: "Trade", portfolio: "Portfolio", career: "Career", rating: "Rating", profile: "Profile" },
  hud: { level: "Lv. {{level}}", balance: "Balance" },
  market: { offline: "No connection to server", stale: "Prices are stale, trading paused", funding: "Funding", nextFunding: "in {{time}}" },
  trade: {
    long: "Long",
    short: "Short",
    margin: "Margin",
    leverage: "Leverage",
    leverageMax: "max {{max}}x at your level",
    size: "Position size",
    quantity: "Quantity",
    liquidation: "Liquidation",
    fee: "Fee (taker)",
    soon: "Opening trades arrives in the next stage",
  },
  placeholder: {
    title: "Coming soon",
    portfolio: "Open positions and trade history will live here.",
    career: "Levels, skills, gear and quests will live here.",
    rating: "Leaderboards and tournaments will live here.",
  },
  profile: { language: "Language", id: "Telegram ID", disclaimer: "All money in the game is virtual. This is not financial advice." },
};
