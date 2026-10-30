import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "./telegram.js";

const TOKEN = "123456:TEST-TOKEN";
const user = { id: 42, first_name: "Vlad", language_code: "ru" };

function make(authDate: number, token = TOKEN) {
  return signInitData(
    { auth_date: String(authDate), query_id: "AAE", user: JSON.stringify(user) },
    token,
  );
}

describe("validateInitData", () => {
  const now = 1_800_000_000_000;

  it("принимает корректно подписанные данные", () => {
    const res = validateInitData(make(now / 1000 - 60), TOKEN, 3600, now);
    expect(res).toEqual({ ok: true, user, authDate: now / 1000 - 60 });
  });

  it("отклоняет подпись другим токеном", () => {
    const res = validateInitData(make(now / 1000, "999:OTHER"), TOKEN, 3600, now);
    expect(res).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("отклоняет изменённые данные", () => {
    const tampered = make(now / 1000).replace("Vlad", "Hack");
    expect(validateInitData(tampered, TOKEN, 3600, now).ok).toBe(false);
  });

  it("отклоняет устаревшие данные", () => {
    const res = validateInitData(make(now / 1000 - 7200), TOKEN, 3600, now);
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("требует hash", () => {
    expect(validateInitData("auth_date=1", TOKEN)).toEqual({ ok: false, reason: "missing_hash" });
  });
});
