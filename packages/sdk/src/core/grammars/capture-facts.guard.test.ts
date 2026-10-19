import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * STRUCTURAL GUARD - capture behavior lives in grammars, never in engine tables. The failure this
 * prevents (owner directive): someone adds a capture and the path of least resistance becomes a
 * walk.ts const + comment - behavior facts accreting back into the engine. A comment or a review
 * hope does not prevent that; this tripwire does, and its message names the fix.
 *
 * The ONE allowed home for capture-keyed behavior is the tier-1 contract file (shared.ts - the
 * shared lingua franca's defaults and wire shapes; promoting a word INTO the shared tier keeps a
 * ceremony). Everything else - definitions, suppression shapes, nesting - is a #set!
 * capture.<name>.<knob> directive in the OWNING grammar's .scm.
 */
const TIER1 = ["shared.ts"];
const ROOTS = [join(import.meta.dir, "..")];

const TRIPWIRES: readonly { readonly name: string; readonly rx: RegExp }[] = [
  // a typed capture-keyed table (the old POLICY / DEFINITION_CAPTURES shapes)
  { name: "typed capture table", rx: /Record<Capture\b|ReadonlySet<Capture>|Set<Capture>/ },
  // a const Set/Record whose KEYS are capture-name string literals (a hand-grown vocabulary)
  {
    name: "capture-name literal table",
    rx: new RegExp(
      '(?:new Set\\(\\[|Record<[^>]*> *= *\\{)[^;]{0,200}?"(?:function|method|class|type|binding|comment|import|docstring|section|paragraph|list_item|list)"',
      "s",
    ),
  },
];

describe("capture-facts guard — capture behavior is a .scm directive, never an engine table", () => {
  test("no engine source outside the tier-1 contract declares a capture-keyed container", async () => {
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(p);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          if (TIER1.includes(entry.name)) continue;
          const text = await readFile(p, "utf8");
          for (const wire of TRIPWIRES) {
            if (wire.rx.test(text)) offenders.push(p + " (" + wire.name + ")");
          }
        }
      }
    }
    for (const root of ROOTS) await walk(root);
    expect(
      offenders,
      "capture behavior is a #set! directive in the owning grammar's .scm - see byog.md; " +
        "shared defaults live only in shared.ts (promoting a word into the shared tier is the ceremony)",
    ).toEqual([]);
  });
});
