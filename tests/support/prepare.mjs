import {
  cp,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const site = join(root, "site");
const runtime = join(root, "tests/.runtime/site");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}).`);
  }
}

if (!existsSync(join(site, "vendor/autoload.php"))) {
  throw new Error(
    "Build the local Espo site first; tests reuse only its core files and PHP dependencies.",
  );
}

// Prepare the browser dependencies used by the extension, without changing build.js.
const vendor = join(root, "src/files/client/custom/modules/calendar-plus/lib");
await mkdir(vendor, { recursive: true });
for (const [name, license] of [
  ["pdf-lib", "LICENSE.md"],
  ["html2canvas", "LICENSE"],
]) {
  const packagePath = join(root, "node_modules", name);
  const source = (
    await readFile(join(packagePath, "dist", `${name}.min.js`), "utf8")
  ).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
  await writeFile(
    join(vendor, `${name}.min.js`),
    `// Generated test build dependency.\n;(function (define) {\n${source}\n}).call(window, undefined);\n`,
  );
  await cp(join(packagePath, license), join(vendor, `${name}.LICENSE`));
}

run(process.execPath, ["build", "--extension"]);
await mkdir(runtime, { recursive: true });

if (process.env.CP_TEST_DEVELOPER_MODE === "1") {
  await cp(
    join(root, "build/assets/transpiled/custom/modules/calendar-plus/src"),
    join(runtime, "client/custom/modules/calendar-plus/lib/transpiled/src"),
    { recursive: true },
  );
}

for (const name of ["application", "vendor", "html", "frontend"]) {
  const destination = join(runtime, name);
  if (!existsSync(destination)) {
    await symlink(join(site, name), destination, "dir");
  }
}
await mkdir(join(runtime, "client"), { recursive: true });
for (const entry of await readdir(join(site, "client"), {
  withFileTypes: true,
})) {
  if (entry.name === "custom") {
    continue;
  }
  const destination = join(runtime, "client", entry.name);
  if (!existsSync(destination)) {
    await symlink(
      join(site, "client", entry.name),
      destination,
      entry.isDirectory() ? "dir" : "file",
    );
  }
}
for (const name of [
  "data",
  "data/cache",
  "data/logs",
  "data/tmp",
  "custom",
  "client/custom",
  "public",
  "public/api/v1",
]) {
  await mkdir(join(runtime, name), { recursive: true });
}
await writeFile(
  join(runtime, ".calendar-plus-test-runtime"),
  "calendar-plus-repository-tests\n",
);
await writeFile(
  join(runtime, "bootstrap.php"),
  `<?php\nchdir(__DIR__);\nset_include_path(__DIR__);\n$loader = require __DIR__ . '/vendor/autoload.php';\n$loader->addPsr4('Espo\\\\Modules\\\\', __DIR__ . '/custom/Espo/Modules', true);\n$loader->addPsr4('Espo\\\\Custom\\\\', __DIR__ . '/custom/Espo/Custom', true);\n`,
);
run(process.env.CP_TEST_PHP || "php", ["tests/support/setup.php"]);
run(process.env.CP_TEST_PHP || "php", ["tests/support/seed.php"]);
