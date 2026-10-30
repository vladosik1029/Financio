import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { LOG_LEVEL: "warn", BOT_TOKEN: "123456:TEST-TOKEN", ADMIN_TOKEN: "test-admin-token-123456" },
  },
});
