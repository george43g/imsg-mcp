import { builtinModules } from "node:module";
import { defineConfig } from "vitest/config";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  "better-sqlite3",
  "imessage-parser",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/server/index.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "@modelcontextprotocol/sdk/types.js",
  "zod",
];

export default defineConfig({
  build: {
    target: "node22",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: nodeExternals,
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Split by mode: mock path tests need `VITE_ENV=ai` (default `pnpm test` + `.env.ai`); execFile
    // stubs need `VITE_ENV=local` (`pnpm test:local` + `.env` / `.env.local`).
    exclude: [
      ...(process.env.VITE_ENV === "local" ? ["**/tests/applescript-mock.test.ts"] : []),
      ...(process.env.VITE_ENV !== "local" ? ["**/tests/applescript-local.test.ts"] : []),
    ],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
