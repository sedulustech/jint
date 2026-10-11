#!/usr/bin/env bun
// Build the jint CLI binary. No arg builds for the host platform; pass a target
// (darwin-arm64, darwin-x64) to cross-compile. Mirrors mobius scripts/build.ts.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const CROSS_TARGETS: Record<
  string,
  { target: "bun-darwin-arm64" | "bun-darwin-x64"; outfile: string }
> = {
  "darwin-arm64": { target: "bun-darwin-arm64", outfile: resolve(root, "out/jint-darwin-arm64") },
  "darwin-x64": { target: "bun-darwin-x64", outfile: resolve(root, "out/jint-darwin-x64") },
};

const cross = process.argv[2] ? CROSS_TARGETS[process.argv[2]] : undefined;
if (process.argv[2] && !cross) throw new Error(`unknown build target: ${process.argv[2]}`);

const buildVersion = (await $`git rev-parse --short HEAD`.text()).trim();
console.log(`building jint (${buildVersion})${cross ? ` for ${cross.target}` : ""}`);

// Every compile path embeds a fresh UI dist (compile assets: served from $bunfs at runtime via
// startUi's resolveDistDir) - build it here, never rely on a leftover. The warning is only for
// genuinely weird states (the app package itself is missing).
const appDist = resolve(root, "packages/app/dist");
if (existsSync(resolve(root, "packages/app"))) {
  await $`bun run --cwd packages/app build`.quiet();
} else {
  console.warn("note: packages/app missing - binary ships without the embedded UI");
}
const assets = existsSync(appDist) ? [appDist] : [];

const result = await Bun.build({
  entrypoints: ["./packages/cli/src/cli.ts"],
  minify: true,
  target: "bun",
  compile: {
    ...(cross
      ? { target: cross.target, outfile: cross.outfile }
      : { outfile: resolve(root, "jint") }),
    ...(assets.length > 0 ? { assets } : {}),
  },
});

if (!result.success) {
  console.error(result.logs.map((l) => l.message).join("\n"));
  process.exit(1);
}
console.log("build ok:", result.outputs.map((o) => o.path).join(", "));
