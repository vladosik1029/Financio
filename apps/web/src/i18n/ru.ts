export const ru = {
  tabs: { trade: "Торговля", portfolio: "Портфель", career: "Карьера", rating: "Рейтинг", profile: "Профиль" },
  hud: { level: "Ур. {{level}}", balance: "Баланс" },
  market: { offline: "Нет связи с сервером", stale: "Цены устарели, торговля на паузе", funding: "Funding", nextFunding: "через {{time}}" },
  trade: {
    long: "Лонг",
    short: "Шорт",
    margin: "Маржа",
    leverage: "Плечо",
    leverageMax: "макс. {{max}}x на вашем уровне",
    size: "Объём позиции",
    quantity: "Количество",
    liquidation: "Ликвидация",
    fee: "Комиссия (taker)",
    soon: "Открытие сделок появится на следующем этапе",
  },
  placeholder: {
    title: "Скоро",
    portfolio: "Здесь будут открытые позиции и история сделок.",
    career: "Здесь будут уровни, навыки, экипировка и квесты.",
    rating: "Здесь будут рейтинги и турниры.",
  },
  profile: { language: "Язык", id: "Telegram ID", disclaimer: "Все деньги в игре виртуальные. Это не финансовый совет." },
};

export type Messages = typeof ru;
