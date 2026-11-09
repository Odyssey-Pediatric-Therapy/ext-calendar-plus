import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const server = spawn(
  process.env.CP_TEST_PHP || "php",
  [
    "-S",
    `127.0.0.1:${process.env.CP_TEST_PORT || 8878}`,
    "-t",
    resolve(root, "tests/.runtime/site"),
    resolve(root, "tests/support/router.php"),
  ],
  { cwd: root, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code || 0));
