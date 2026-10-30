import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { validateInitData, type TelegramUser } from "./telegram.js";

declare module "fastify" {
  interface FastifyRequest {
    tgUser?: TelegramUser;
  }
}

const DEV_USER: TelegramUser = { id: 1, first_name: "Dev", username: "dev", language_code: "ru" };

/**
 * Проверяет заголовок `Authorization: tma <initData>`.
 * В режиме DEV_AUTH_BYPASS без заголовка подставляется тестовый игрок.
 */
export async function requireTelegramUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? "";
  const [scheme, initData] = header.split(" ", 2);

  if (scheme === "tma" && initData && config.botToken) {
    const res = validateInitData(initData, config.botToken);
    if (res.ok) {
      req.tgUser = res.user;
      return;
    }
    return reply.code(401).send({ error: res.reason });
  }

  if (config.devAuthBypass) {
    req.tgUser = DEV_USER;
    return;
  }
  return reply.code(401).send({ error: "unauthorized" });
}
