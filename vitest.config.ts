import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@coordinator/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@coordinator/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@coordinator/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node"
  }
});
