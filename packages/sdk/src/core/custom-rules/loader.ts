/**
 * Loads config-declared custom rule files on the embedded Bun runtime (spike-validated:
 * /tmp/jint-spike/host.ts, bun 1.3.14). A runtime Bun.plugin registers the virtual module
 * "jint:sdk" — the colon marks it runtime-injected (node:fs convention): unshadowable, and
 * build.module intercepts it before any disk lookup, including inside compiled binaries.
 *
 * The import gate is a STATIC PRE-SCAN, not plugin denial: plugins cannot deny node:* builtins
 * (build.module on a builtin throws at setup and kills every rule), so before import() the file is
 * scanned with Bun.Transpiler.scanImports — jint:*, ./, / pass; bare specifiers and builtins are
 * rejected with a clear jint error. Known v1 limits (design rules-context/03): the scan covers the
 * entry file only; dynamic import() inside rules bypasses the gate.
 *
 * Loading is a setup concern: any failure (gate, thrown module, invalid defineConfig) throws
 * SetupError RULE_INVALID naming the file — the run fails fast, never half-configured.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultRuleSpecs } from "@jint/defaults";
import { SetupError } from "../types.ts";
import {
  defineConfig,
  validateCustomRule,
  type CustomConfigFragment,
  type CustomRule,
} from "./sdk.ts";

let registered = false;

/**
 * Registers the virtual modules exactly once per process: "jint:sdk" (the rule-author API) and
 * "jint:defaults" (the DECLARATIVE default specs — never compiled Rule objects; design
 * config-composition/03). build.module intercepts both before any disk lookup, so they resolve
 * inside compiled binaries too, and external users need no install.
 */
export function registerCustomRuleLoader(): void {
  if (registered) return;
  registered = true;
  Bun.plugin({
    name: "jint-sdk",
    setup(build) {
      build.module("jint:sdk", () => ({
        exports: { defineConfig },
        loader: "object",
      }));
      build.module("jint:defaults", () => ({
        exports: { defaultRuleSpecs, ...defaultRuleSpecs },
        loader: "object",
      }));
    },
  });
}

/**
 * True when a scanned import may pass the gate: a jint:* virtual module, the first-party defaults
 * package, or a relative/absolute file. Bare npm specifiers and node:* builtins stay rejected — the
 * sandbox line is unchanged. @jint/defaults is allowed deliberately: it is install-time versioned,
 * where the jint:defaults virtual module's version IS the CLI baseline (design
 * config-composition/03, versioned-defaults/01).
 */
function allowedImport(specifier: string): boolean {
  return (
    specifier.startsWith("jint:") ||
    specifier === "@jint/defaults" ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/")
  );
}

/**
 * The static pre-scan gate: every static import of the entry file must be jint:_, relative, or
 * absolute. Bare specifiers and node:_ builtins are rejected BEFORE import() runs.
 */
function gateImports(path: string, source: string): void {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const imports = transpiler.scanImports(source);
  for (const imp of imports) {
    if (!allowedImport(imp.path)) {
      throw new SetupError(
        "RULE_INVALID",
        'custom rule file imports "' +
          imp.path +
          '" (' +
          path +
          ') — only "jint:*", relative (./, ../), and absolute imports are allowed',
      );
    }
  }
}

/** Loads one file: gate, import, validate the fragment; returns the rules it contributes. */
export async function loadCustomRuleFile(path: string): Promise<CustomRule[]> {
  const abs = resolve(path);
  let mod: unknown;
  registerCustomRuleLoader();
  try {
    // The gate reads + scans before the transpile: a rejected file never executes.
    gateImports(abs, readFileSync(abs, "utf8"));
    mod = await import(abs);
  } catch (thrown) {
    if (thrown instanceof SetupError) throw thrown;
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new SetupError(
      "RULE_INVALID",
      "custom rule file failed to load: " + path + ": " + detail,
      {
        cause: thrown,
      },
    );
  }
  return contributedRules(mod, path);
}

function contributedRules(mod: unknown, path: string): CustomRule[] {
  const exported = (mod as { default?: unknown }).default;
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "custom rule file " + path + ": " + message);
  };
  if (exported === undefined) {
    fail('must default-export defineConfig({ rules: [...] }) from "jint:sdk"');
  }
  const fragments = Array.isArray(exported) ? exported : [exported];
  const rules: CustomRule[] = [];
  for (const fragment of fragments) {
    const f = fragment as CustomConfigFragment;
    if (typeof f !== "object" || f === null || !Array.isArray(f.rules)) {
      fail("default export is not a defineConfig fragment (missing rules array)");
    }
    for (const rule of f.rules) rules.push(validateCustomRule(rule, path));
  }
  return rules;
}

/**
 * Gated import of a TS config module: registers the virtual modules, pre-scans the imports (the
 * same gate as rule files: colon-specifiers, relative, absolute), and returns the module's default
 * export — the partial config (rules, include, exclude) the config boundary validates.
 */
export async function importConfigModule(abs: string): Promise<unknown> {
  registerCustomRuleLoader();
  // The gate reads + scans before the transpile: a rejected file never executes.
  gateImports(abs, readFileSync(abs, "utf8"));
  try {
    const mod = (await import(abs)) as { default?: unknown };
    return mod.default;
  } catch (thrown) {
    if (thrown instanceof SetupError) throw thrown;
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new SetupError("CONFIG_INVALID", "config module failed to load: " + abs + ": " + detail, {
      cause: thrown,
    });
  }
}

/** Loads every config-declared custom rule file, in declared order, and rejects duplicate names. */
export async function loadCustomRules(paths: readonly string[]): Promise<CustomRule[]> {
  const out: CustomRule[] = [];
  const seen = new Map<string, string>();
  for (const path of paths) {
    for (const rule of await loadCustomRuleFile(path)) {
      const prior = seen.get(rule.name);
      if (prior !== undefined) {
        throw new SetupError(
          "RULE_INVALID",
          'duplicate custom rule name "' + rule.name + '" (' + prior + " and " + path + ")",
        );
      }
      seen.set(rule.name, path);
      out.push(rule);
    }
  }
  return out;
}
