import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试前要启动 PGlite、跑迁移、用 Argon2 建账号；冷启动时会超过默认的 10 秒
    hookTimeout: 60_000,
  },
});
