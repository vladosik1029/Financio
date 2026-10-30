import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
if (!token || !webAppUrl) {
  console.error("Нужны переменные BOT_TOKEN и WEBAPP_URL (см. .env.example)");
  process.exit(1);
}

const texts = {
  ru: {
    greeting:
      "Добро пожаловать в iZZi Financio!\n\nТоргуй фьючерсами на реальных ценах, прокачивай трейдера и поднимайся в рейтинге. Деньги в игре виртуальные.",
    open: "Открыть терминал",
    menu: "Играть",
  },
  en: {
    greeting:
      "Welcome to iZZi Financio!\n\nTrade futures on real market prices, level up your trader and climb the leaderboard. All money in the game is virtual.",
    open: "Open terminal",
    menu: "Play",
  },
} as const;

function lang(code?: string): keyof typeof texts {
  return code?.startsWith("ru") ? "ru" : "en";
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  const t = texts[lang(ctx.from?.language_code)];
  await ctx.reply(t.greeting, {
    reply_markup: new InlineKeyboard().webApp(t.open, webAppUrl),
  });
});

bot.catch((err) => console.error("Ошибка бота:", err.error));

// Кнопка меню рядом с полем ввода открывает MiniApp
await bot.api.setChatMenuButton({
  menu_button: { type: "web_app", text: texts.ru.menu, web_app: { url: webAppUrl } },
});
await bot.api.setMyCommands([{ command: "start", description: "Начать игру" }], { language_code: "ru" });
await bot.api.setMyCommands([{ command: "start", description: "Start the game" }]);

bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен`) });
