/**
 * Guards the ambient declaration for the "jint:defaults" virtual module. Two failure modes:
 *
 * 1. RESOLUTION: the re-export inside declare module must resolve under tsc AND tsserver. A relative
 *    "./index.ts" import resolves under the repo tsc (allowImportingTsExtensions) but tsserver
 *    refuses .ts-extension imports from a .d.ts - the module silently loses every member and rule
 *    files squiggle "no exported member" in the editor while CI stays green. The package specifier
 *    ("@jint/defaults", via package exports) resolves everywhere; the text guard below pins that
 *    shape.
 * 2. SURFACE: the type imports below fail to compile if the re-export chain drops a name (type-only -
 *    the virtual module exists at runtime only inside the sdk loader); the package's own value
 *    surface is asserted by importing it for real.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { defaultRules } from "@jint/defaults";
import type { RuleSchema, NoulRuleSchema } from "jint:defaults";

const _schemaCheck: RuleSchema = defaultRules[0];
const _noulCheck: NoulRuleSchema["kind"] = "noul";
void _schemaCheck;
void _noulCheck;

describe("jint:defaults ambient declaration", () => {
  it("re-exports via a package specifier, never a relative .ts path", () => {
    const dts = readFileSync(new URL("./defaults.d.ts", import.meta.url), "utf8");
    expect(dts).toContain('export * from "@jint/defaults"');
    expect(dts).not.toMatch(/export \* from "\.\//);
  });
});
