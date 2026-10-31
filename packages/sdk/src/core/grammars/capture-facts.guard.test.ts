import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * STRUCTURAL GUARD - capture behavior lives in grammars, never in engine tables. The failure this
 * prevents (owner directive): someone adds a capture and the path of least resistance becomes a
 * walk.ts const + comment - behavior facts accreting back into the engine. A comment or a review
 * hope does not prevent that; this tripwire does, and its message names the fix.
 *
 * The ONE allowed home for capture-keyed behavior is the tier-1 contract file (shared.ts - the
 * shared lingua franca's defaults and wire shapes; promoting a word INTO the shared tier keeps a
 * ceremony). Everything else - definitions, suppression shapes, nesting, projection - is a #set!
 * capture.<name>.<knob> directive in the OWNING grammar's .scm.
 *
 * Every tripwire shape below has a PLANTED NEGATIVE TEST (red-verified: the collector must flag
 * each shape when it is genuinely present) - an unverified guard is a green light, not a guard.
 */
// import.meta.dir = packages/sdk/src/core/grammars - FIVE ups to the repo root. The first draft
// walked four (into packages/), every root silently failed readdir, and the guard passed
// vacuously - the planted negatives caught it; they are load-bearing.
const REPO = join(import.meta.dir, "..", "..", "..", "..", "..");
// the tier-1 whitelist is a PATH, not a basename - a same-named file elsewhere is not the contract
const TIER1 = join(import.meta.dir, "shared.ts");
const GRAMMARS = join(import.meta.dir);
const ROOTS = [
  join(REPO, "packages", "sdk", "src", "core"),
  join(REPO, "packages", "contract", "src"),
  join(REPO, "packages", "rules", "src"),
  ...readdirSync(join(REPO, "packages", "rules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "src" && entry.name !== "node_modules")
    .map((entry) => join(REPO, "packages", "rules", entry.name, "src")),
  join(REPO, "packages", "cli", "src"),
];

const CAPTURE_NAMES =
  "function|method|class|type|binding|comment|import|docstring|section|paragraph|list_item|list";
/**
 * The unquoted-key wire EXCLUDES `type` (and would exclude any equally generic key): `type:` is a
 * legitimate key in node-descriptor code (query.ts's `type: elementNode.type`), so it fires only
 * through the typed/quoted wires, whose container shapes disambiguate - a real capture table also
 * carries `function:`/`method:`/... and one of those fires.
 */
const UNQUOTED_KEY_NAMES = CAPTURE_NAMES.replace("|type", "");

/** A wire that must fire ANYWHERE (except shared.ts): a typed or literal capture-keyed table. */
const CONSERVATIVE: readonly { readonly name: string; readonly rx: RegExp }[] = [
  { name: "typed capture table", rx: /Record<Capture\b|ReadonlySet<Capture>|Set<Capture>/ },
  {
    name: "quoted capture-literal container",
    rx: new RegExp(
      `(?:new Set\\(\\[[^\\]]*|Record<[^>=]*>\\s*=\\s*\\{[^}]*?)"(?:${CAPTURE_NAMES})"`,
      "s",
    ),
  },
  {
    name: "quoted capture-literal Map",
    rx: new RegExp(`new Map\\(\\[\\[[^\\]]*"(?:${CAPTURE_NAMES})"`, "s"),
  },
  {
    name: "capture-literal switch arm",
    rx: new RegExp(`case\\s+"(?:${CAPTURE_NAMES})"\\s*:`),
  },
];

/**
 * A wire for the ENGINE's grammar sources only: capture-keyed object literals (unquoted keys - the
 * shape a dead PROJECTION dodged the first guard with). Too generic for the whole repo (`type:` is
 * a common innocent key outside the engine); inside grammars/ it is not.
 */
const AGGRESSIVE: readonly { readonly name: string; readonly rx: RegExp }[] = [
  {
    name: "capture-keyed object literal",
    rx: new RegExp(`(?:^|\\{)\\s*(?:${UNQUOTED_KEY_NAMES})\\s*:`, "m"),
  },
];

export interface Offender {
  readonly file: string;
  readonly wire: string;
}

/** Scan every source file under ROOTS (minus .test.ts and the tier-1 path). */
async function collectOffenders(): Promise<Offender[]> {
  const offenders: Offender[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // a package without src is not an offender
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && p !== TIER1) {
        const text = await readFile(p, "utf8");
        const wires = p.startsWith(GRAMMARS) ? [...CONSERVATIVE, ...AGGRESSIVE] : CONSERVATIVE;
        for (const wire of wires)
          if (wire.rx.test(text)) offenders.push({ file: p, wire: wire.name });
      }
    }
  }
  for (const root of ROOTS) await walk(root);
  return offenders;
}

const FIX =
  "capture behavior is a #set! directive in the owning grammar's .scm - see byog.md; " +
  "shared defaults live only in shared.ts (promoting a word into the shared tier is the ceremony)";

describe("capture-facts guard — capture behavior is a .scm directive, never an engine table", () => {
  test("no engine source outside the tier-1 contract declares a capture-keyed container", async () => {
    expect(await collectOffenders(), FIX).toEqual([]);
  });

  // RED-VERIFIED NEGATIVES: each planted shape must fire its named wire. If one of these fails
  // green, the guard is bypassable and the positive test above is a false promise.
  const PLANTS: readonly {
    readonly shape: string;
    readonly wire: string;
    readonly code: string;
  }[] = [
    {
      shape: "typed table",
      wire: "typed capture table",
      code: "const X: Record<Capture, number> = null as never;\n",
    },
    {
      shape: "Set literal",
      wire: "quoted capture-literal container",
      code: 'const X = new Set(["function", "type"]);\n',
    },
    {
      shape: "Map literal",
      wire: "quoted capture-literal Map",
      code: 'const X = new Map([["function", 1]]);\n',
    },
    {
      shape: "switch arm",
      wire: "capture-literal switch arm",
      code: 'switch (c) { case "function": break; }\n',
    },
    {
      shape: "unquoted key",
      wire: "capture-keyed object literal",
      code: "const X = { function: 1 };\n",
    },
  ];
  for (const plant of PLANTS) {
    test(`planted ${plant.shape} fires the guard (${plant.wire})`, async () => {
      const probe = join(GRAMMARS, `planted-${plant.shape.replace(" ", "-")}.guard-probe.ts`);
      try {
        await writeFile(probe, plant.code);
        const offenders = await collectOffenders();
        expect(
          offenders.some((o) => o.file === probe && o.wire === plant.wire),
          FIX,
        ).toBe(true);
      } finally {
        await rm(probe, { force: true });
      }
    });
  }
});
