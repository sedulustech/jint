#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const require2 = createRequire(__filename);
const dir = require("node:path").dirname(
  require2.resolve("@sedulus/jint-" + process.platform + "-" + process.arch + "/package.json"),
);
try {
  execFileSync(dir + "/jint", process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
