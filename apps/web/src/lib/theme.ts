/**
 * Цвета для мест, куда CSS-переменные не доходят: график и шапка Telegram.
 * Держать в синхроне с :root в styles/global.css.
 * brand — временный акцент, пока не подставлены фирменные цвета iZZi.
 */
export const theme = {
  bg: "#0b0c0f",
  surface: "#16181d",
  grid: "#1b1e24",
  border: "#262a32",
  muted: "#81858c",
  up: "#20b26c",
  down: "#ef454a",
  brand: "#f7a600",
} as const;
