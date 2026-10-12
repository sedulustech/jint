import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SetupError } from "../types.ts";
import {
  defineConfig,
  validateCustomRule,
  type CustomConfigFragment,
  type CustomRule,
} from "./sdk.ts";

let registered = false;
let defaultsProvider: Record<string, unknown> | undefined;

/**
 * Registers the virtual modules exactly once per process: "jint:sdk" (the rule-author API) and
 * "jint:defaults" (the DECLARATIVE default specs — never compiled Rule objects; design
 * config-composition/03). build.module intercepts both before any disk lookup, so they resolve
 * inside compiled binaries too, and external users need no install.
 */
export function registerCustomRuleLoader(
  virtuals: { defaults?: Record<string, unknown> } = {},
): void {
  if (virtuals.defaults !== undefined) defaultsProvider = virtuals.defaults;
  if (registered) return;
  registered = true;
  Bun.plugin({
    name: "jint-sdk",
    setup(build) {
      build.module("jint:sdk", () => ({
        exports: { defineConfig },
        loader: "object",
      }));
      // The provider is read at import time, not captured here: an entry point may register bare
      // first and supply the defaults later (any time before the first import resolves).
      build.module("jint:defaults", () => {
        if (defaultsProvider === undefined) {
          throw new SetupError(
            "RULE_INVALID",
            "jint:defaults is not provided - the entry point must register the defaults provider (registerCustomRuleLoader({ defaults: defaultRuleSpecs }))",
          );
        }
        return {
          exports: { defaultRuleSpecs: defaultsProvider, ...defaultsProvider },
          loader: "object",
        };
      });
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
export async function loadCustomRuleFile(path: string): Promise<LoadedRules> {
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
  return customRules(mod, path);
}

export type LoadedRules = {
  custom: CustomRule[];
  declarative: { entry: unknown; source: string }[];
};

/**
 * The rules a loaded module contributes, validated per shape: an entry carrying a classify function
 * is a callback rule (custom engine); one without is DECLARATIVE data and compiles through the same
 * seam a config-file rule entry takes (compileRule). Scoping has two levels: the fragment's
 * include/exclude is the default for its rules, and a rule declaring its own scope replaces it
 * wholesale (rule-level wins - design defaults-nursery/02).
 */
function customRules(mod: unknown, path: string): LoadedRules {
  const exported = (mod as { default?: unknown }).default;
  const fail = (message: string): never => {
    throw new SetupError("RULE_INVALID", "custom rule file " + path + ": " + message);
  };
  if (exported === undefined) {
    fail('must default-export defineConfig({ rules: [...] }) from "jint:sdk"');
  }
  const fragments = Array.isArray(exported) ? exported : [exported];
  const out: LoadedRules = { custom: [], declarative: [] };
  for (const fragment of fragments) {
    const f = fragment as CustomConfigFragment;
    if (typeof f !== "object" || f === null || !Array.isArray(f.rules)) {
      fail("default export is not a defineConfig fragment (missing rules array)");
    }
    for (const rule of f.rules) {
      const entry = rule as {
        classify?: unknown;
        include?: readonly string[];
        exclude?: readonly string[];
      };
      // two scoping levels: the fragment's include/exclude is the DEFAULT scope for its rules;
      // a rule declaring ANY scope of its own replaces it WHOLESALE - fragment fields never merge
      // into a scoped rule (design defaults-nursery/02: rule-level wins)
      let scoped = entry;
      if (entry.include === undefined && entry.exclude === undefined) {
        scoped = {
          ...entry,
          ...(f.include !== undefined ? { include: f.include } : {}),
          ...(f.exclude !== undefined ? { exclude: f.exclude } : {}),
        };
      }
      if (typeof entry.classify === "function") {
        out.custom.push(validateCustomRule(scoped, path));
      } else {
        out.declarative.push({ entry: scoped, source: path });
      }
    }
  }
  return out;
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
export async function loadCustomRules(paths: readonly string[]): Promise<LoadedRules> {
  const out: LoadedRules = { custom: [], declarative: [] };
  const seen = new Map<string, string>();
  const claim = (name: string, path: string): void => {
    const prior = seen.get(name);
    if (prior !== undefined) {
      throw new SetupError(
        "RULE_INVALID",
        'duplicate custom rule name "' + name + '" (' + prior + " and " + path + ")",
      );
    }
    seen.set(name, path);
  };
  for (const path of paths) {
    const loaded = await loadCustomRuleFile(path);
    for (const rule of loaded.custom) {
      claim(rule.name, path);
      out.custom.push(rule);
    }
    for (const { entry, source } of loaded.declarative) {
      claim((entry as { name: string }).name, path);
      out.declarative.push({ entry, source });
    }
  }
  return out;
}
