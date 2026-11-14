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
  { target: "bun-darwin-arm64" | "bun-darwin-x64" | "bun-linux-arm64"; outfile: string }
> = {
  "darwin-arm64": { target: "bun-darwin-arm64", outfile: resolve(root, "out/jint-darwin-arm64") },
  "darwin-x64": { target: "bun-darwin-x64", outfile: resolve(root, "out/jint-darwin-x64") },
  // the @sedulus/jint-linux-arm64 npm package needs this binary; built on the
  // linux runner next to the host build
  "linux-arm64": { target: "bun-linux-arm64", outfile: resolve(root, "out/jint-linux-arm64") },
};

const cross = process.argv[2] ? CROSS_TARGETS[process.argv[2]] : undefined;
if (process.argv[2] && !cross) throw new Error(`unknown build target: ${process.argv[2]}`);

// A beta build names itself by its commit, the first 6 characters the site's beta directory uses:
// `jint --version` prints beta-<sha6>. Every other build keeps the package version.
const commit = (await $`git rev-parse --short=6 HEAD`.text()).trim();
const buildVersion = process.env.JINT_BETA ? `beta-${commit}` : undefined;
console.log(`building jint (${buildVersion ?? commit})${cross ? ` for ${cross.target}` : ""}`);

// Every compile path embeds a fresh UI dist (compile assets: served from $bunfs at runtime via
// startUi's resolveDistDir) - build it here, never rely on a leftover. The warning is only for
// genuinely weird states (the app package itself is missing).
// A test that needs only the binary's commands sets JINT_BUILD_NO_UI=1 to skip that build; no
// release build sets it.
const appDist = resolve(root, "packages/app/dist");
const noUi = process.env.JINT_BUILD_NO_UI === "1";
if (noUi) {
  console.warn("note: JINT_BUILD_NO_UI=1 - binary ships without the embedded UI");
} else if (existsSync(resolve(root, "packages/app"))) {
  await $`bun run --cwd packages/app build`.quiet();
} else {
  console.warn("note: packages/app missing - binary ships without the embedded UI");
}
const assets = !noUi && existsSync(appDist) ? [appDist] : [];

// Branched whole literal: the Bun compile config distinguishes cross targets; the assets key
// exists only when there are assets (Bun globs it, so undefined is not semantically identical).
const compile: { target?: string; outfile: string; assets?: string[] } = cross
  ? { target: cross.target, outfile: cross.outfile }
  : { outfile: resolve(root, "jint") };
if (assets.length > 0) compile.assets = assets;

// The walk worker is a second entrypoint so the binary embeds it; the define names its path.
const define: Record<string, string> = {
  JINT_WALK_WORKER: JSON.stringify("./sdk/src/core/walk-worker.js"),
};
if (buildVersion !== undefined) define.JINT_BUILD_VERSION = JSON.stringify(buildVersion);
const result = await Bun.build({
  entrypoints: ["./packages/cli/src/cli.ts", "./packages/sdk/src/core/walk-worker.ts"],
  minify: true,
  target: "bun",
  compile,
  define,
});

if (!result.success) {
  console.error(result.logs.map((l) => l.message).join("\n"));
  process.exit(1);
}
console.log("build ok:", result.outputs.map((o) => o.path).join(", "));
