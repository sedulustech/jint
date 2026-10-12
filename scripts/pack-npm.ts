#!/usr/bin/env bun
import { existsSync } from "node:fs";
// Pack the five npm distribution tarballs (@sedulus/jint meta + four platform
// binary packages) from built platform binaries. PACK-ONLY: nothing is published
// here - the tarballs land in dist-npm/ for npm publish --dry-run checks on
// release day (publish is the commented, secret-gated job in release.yml).
// The version comes from the caller (the tag, vX.Y.Z) - never from package.json:
// the tag version is the canon version. Templates live in scripts/templates/npm/;
// they are NOT workspace packages, only rendered and packed at release time.
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const PLATFORMS = [
  { platform: "linux-x64", os: "linux", cpu: "x64", binary: "out/jint-linux-x64" },
  { platform: "linux-arm64", os: "linux", cpu: "arm64", binary: "out/jint-linux-arm64" },
  { platform: "darwin-x64", os: "darwin", cpu: "x64", binary: "out/jint-darwin-x64" },
  { platform: "darwin-arm64", os: "darwin", cpu: "arm64", binary: "out/jint-darwin-arm64" },
];

const version = process.argv[2];
if (!version || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  throw new Error("usage: pack-npm.ts <version>   # tag form vX.Y.Z");
}
const versionNumber = version.slice(1);

const outDir = resolve(root, "dist-npm");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// render a template: fill every placeholder, then prove it stayed valid JSON
const render = async (template: string, extra: Record<string, string> = {}) => {
  const pkg = (await readFile(resolve(root, "scripts/templates/npm", template), "utf8"))
    .replaceAll("__VERSION__", versionNumber)
    .replace(/__PLATFORM__|__OS__|__CPU__/g, (m) => extra[m] ?? m);
  JSON.parse(pkg);
  return pkg;
};

const pack = async (dirName: string) => {
  await $`npm pack --pack-destination ${outDir} --silent ${resolve(outDir, dirName)}`;
  console.log(
    `packed ${JSON.parse(await readFile(resolve(outDir, dirName, "package.json"), "utf8")).name}`,
  );
};

// meta package: the five-line bin shim + optionalDependencies on the platforms
{
  const pkg = await render("meta/package.json");
  const dir = resolve(outDir, "jint");
  await mkdir(resolve(dir, "bin"), { recursive: true });
  await cp(resolve(root, "scripts/templates/npm/meta/bin/jint.js"), resolve(dir, "bin/jint.js"));
  await writeFile(resolve(dir, "package.json"), pkg);
  await pack("jint");
}

// platform packages: just the binary
for (const p of PLATFORMS) {
  if (!existsSync(p.binary)) {
    console.warn(`skip @sedulus/jint-${p.platform}: ${p.binary} not built`);
    continue;
  }
  const pkg = await render("platform/package.json", {
    __PLATFORM__: p.platform,
    __OS__: p.os,
    __CPU__: p.cpu,
  });
  const dir = resolve(outDir, `jint-${p.platform}`);
  await mkdir(dir, { recursive: true });
  await cp(p.binary, resolve(dir, "jint"));
  await chmod(resolve(dir, "jint"), 0o755);
  await writeFile(resolve(dir, "package.json"), pkg);
  await pack(`jint-${p.platform}`);
}

console.log((await $`ls -1 ${outDir}/*.tgz`.text()).trim());
