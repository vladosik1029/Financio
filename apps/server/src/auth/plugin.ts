import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { validateInitData, type TelegramUser } from "./telegram.js";

declare module "fastify" {
  interface FastifyRequest {
    tgUser?: TelegramUser;
  }
}

export const DEV_USER: TelegramUser = { id: 1, first_name: "Dev", username: "dev", language_code: "ru" };

/**
 * Игрок по initData: из заголовка `Authorization: tma <initData>` или из строки запроса WebSocket.
 * В режиме DEV_AUTH_BYPASS без initData подставляется тестовый игрок.
 */
export function resolveTelegramUser(initData: string | undefined): TelegramUser | { error: string } {
  if (initData && config.botToken) {
    const res = validateInitData(initData, config.botToken);
    return res.ok ? res.user : { error: res.reason };
  }
  if (config.devAuthBypass) return DEV_USER;
  return { error: "unauthorized" };
}

export async function requireTelegramUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const [scheme, initData] = (req.headers.authorization ?? "").split(" ", 2);
  const user = resolveTelegramUser(scheme === "tma" ? initData : undefined);
  if ("error" in user) return reply.code(401).send({ error: user.error });
  req.tgUser = user;
}
