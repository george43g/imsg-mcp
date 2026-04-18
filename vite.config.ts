import { builtinModules } from "node:module";
import { defineConfig } from "vitest/config";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  "better-sqlite3",
  "bplist-parser",
  "commander",
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
      entry: {
        index: "src/index.ts",
        cli: "src/cli.ts",
        tui: "src/tui.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: nodeExternals,
      output: {
        banner: (chunk) =>
          chunk.isEntry ? "#!/usr/bin/env node" : "",
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
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
