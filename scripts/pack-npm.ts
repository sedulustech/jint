#!/usr/bin/env bun
import { existsSync } from "node:fs";
// Pack the five npm distribution tarballs (@sedulus/jint meta + four platform
// binary packages) from the built platform binaries. PACK-ONLY: nothing is
// published here - the tarballs land in dist-npm/ and publish is the release
// fan-in job in release.yml (scripts/publish-npm.sh).
//
// npm/* at the repo root hold the real, reviewable publishable shapes - a
// dedicated top-level npm/ because packages/ means workspace members, and
// these are publish units that live outside the workspace; nothing in the
// repo depends on them. The version is
// the tag's - the one canon version - stamped over the checked-in placeholder
// (one regex across all five package.jsons: own version and every internal
// dependency pin move together, in lockstep, from one string), then the built
// binaries are copied into the platform slots and each dir is packed as-is.
//
//   bun scripts/pack-npm.ts <version>   # tag form vX.Y.Z
import { cp, chmod, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const NPM_DIR = resolve(root, "npm");

const version = process.argv[2];
if (!version || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  throw new Error("usage: pack-npm.ts <version>   # tag form vX.Y.Z[-suffix]");
}
const versionNumber = version.slice(1);

const BINARIES: Record<string, string> = {
  "jint-linux-x64": "out/jint-linux-x64",
  "jint-linux-arm64": "out/jint-linux-arm64",
  "jint-darwin-x64": "out/jint-darwin-x64",
  "jint-darwin-arm64": "out/jint-darwin-arm64",
};

const outDir = resolve(root, "dist-npm");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// one regex over all five package.jsons: the placeholder version is the only
// thing that needs stamping, because the meta's dependency pins carry it too
for (const dir of await readdir(NPM_DIR)) {
  const pkgPath = resolve(NPM_DIR, dir, "package.json");
  const pkg = await readFile(pkgPath, "utf8");
  if (!pkg.includes('"version": "0.0.0"'))
    throw new Error(`${dir}: placeholder version already stamped or drifted`);
  await Bun.write(pkgPath, pkg.replaceAll('"version": "0.0.0"', `"version": "${versionNumber}"`));
}

for (const [dir, binary] of Object.entries(BINARIES)) {
  if (!existsSync(resolve(root, binary))) throw new Error(`${binary} not built`);
  await cp(resolve(root, binary), resolve(NPM_DIR, dir, "jint"));
  await chmod(resolve(NPM_DIR, dir, "jint"), 0o755);
}

for (const dir of (await readdir(NPM_DIR)).sort()) {
  await $`npm pack --pack-destination ${outDir} --silent ${resolve(NPM_DIR, dir)}`;
  const name = JSON.parse(await readFile(resolve(NPM_DIR, dir, "package.json"), "utf8")).name;
  console.log(`packed ${name}`);
}

console.log((await $`ls -1 ${outDir}/*.tgz`.text()).trim());
