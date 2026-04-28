import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/entrypoints/cli.ts"],
    format: "esm",
    target: "node20",
    clean: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: ["src/services/workers/sqlite-worker.ts", "src/services/workers/cpu-worker.ts"],
    format: "esm",
    target: "node20",
    clean: false,
  },
]);
