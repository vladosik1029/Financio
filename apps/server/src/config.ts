import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  BOT_TOKEN: z.string().default(""),
  PRICE_FEED: z.enum(["binance", "mock"]).default("binance"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  DEV_AUTH_BYPASS: bool,
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().default("pglite://./data/pglite"),
  ADMIN_TOKEN: z.string().default(""),
});

const env = schema.parse(process.env);

if (env.NODE_ENV === "production" && env.DEV_AUTH_BYPASS) {
  throw new Error("DEV_AUTH_BYPASS нельзя включать в production");
}

export const config = {
  port: env.PORT,
  botToken: env.BOT_TOKEN,
  priceFeed: env.PRICE_FEED,
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  devAuthBypass: env.DEV_AUTH_BYPASS,
  databaseUrl: env.DATABASE_URL,
  /** Пароль админки. Пустой — админка выключена */
  adminToken: env.ADMIN_TOKEN,
};

if (config.adminToken && config.adminToken.length < 16) {
  throw new Error("ADMIN_TOKEN должен быть не короче 16 символов");
}
