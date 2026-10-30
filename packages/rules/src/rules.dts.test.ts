/**
 * Guards the ambient declarations for the "jint:rules/<domain>" virtual modules. Two failure modes:
 *
 * 1. RESOLUTION: each re-export inside declare module must resolve under tsc AND tsserver. A relative
 *    "./index.ts" import resolves under the repo tsc (allowImportingTsExtensions) but tsserver
 *    refuses .ts-extension imports from a .d.ts - the module silently loses every member and rule
 *    files squiggle "no exported member" in the editor while CI stays green. The package specifier
 *    ("@jint/rules-<domain>", via package exports) resolves everywhere; the text guard below pins
 *    that shape.
 * 2. COVERAGE: every domain the aggregate names has a declaration, and no declaration is orphaned.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { domains } from "@jint/rules";
import type { RuleSchema, NoulRuleSchema } from "jint:rules/comments";

const _schemaCheck: RuleSchema | undefined = undefined;
const _noulCheck: NoulRuleSchema["kind"] = "noul";
void _schemaCheck;
void _noulCheck;

const dts = readFileSync(new URL("./rules.d.ts", import.meta.url), "utf8");

describe("jint:rules/* ambient declarations", () => {
  it("re-exports via a package specifier, never a relative .ts path", () => {
    expect(dts).not.toMatch(/export \* from "\.\//);
  });

  it("declares exactly the aggregate's domains", () => {
    const declared = [
      ...dts.matchAll(
        /declare module "jint:rules\/([\w/-]+)" \{\s*export \* from "@jint\/rules-([\w-]+)";/g,
      ),
    ];
    expect(declared.map((m) => m[1]).sort()).toEqual(Object.keys(domains).sort());
    for (const m of declared) expect(m[2]).toBe(m[1]!);
  });
});
