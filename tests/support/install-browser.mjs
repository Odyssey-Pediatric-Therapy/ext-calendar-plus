import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "install", "chromium"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: new URL("../.runtime/browsers", import.meta.url)
        .pathname,
    },
  },
);
process.exit(result.status ?? 1);
