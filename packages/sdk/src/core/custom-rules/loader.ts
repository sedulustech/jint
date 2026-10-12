import { readFileSync } from "node:fs";
import { SetupError } from "../types.ts";
import { defineConfig } from "./sdk.ts";

let registered = false;
let defaultsProvider: readonly unknown[] | undefined;

/**
 * Registers the virtual modules exactly once per process: "jint:sdk" (the rule-author API) and
 * "jint:defaults" (the DECLARATIVE default specs — never compiled Rule objects; design
 * config-composition/03). build.module intercepts both before any disk lookup, so they resolve
 * inside compiled binaries too, and external users need no install. The scheme specifier is the
 * PORTABLE config-facing spelling; bare @jint/* stays a workspace package form and is NOT
 * intercepted — see docs/designs/default-rule-specifiers.md.
 */
export function registerCustomRuleLoader(virtuals: { defaults?: readonly unknown[] } = {}): void {
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
      // first and supply the defaults later (any time before the first import resolves). The
      // surface mirrors @jint/defaults: defaultRules (the whole array) plus each rule under its
      // own name for pick-and-override.
      build.module("jint:defaults", () => {
        if (defaultsProvider === undefined) {
          throw new SetupError(
            "RULE_INVALID",
            "jint:defaults is not provided - the entry point must register the defaults provider (registerCustomRuleLoader({ defaults: defaultRules }))",
          );
        }
        const byName = Object.fromEntries(
          defaultsProvider.map((spec) => [(spec as { name: string }).name, spec]),
        );
        return {
          exports: { ...byName, defaultRules: defaultsProvider },
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
        'TS config imports "' +
          imp.path +
          '" (' +
          path +
          ') — only "jint:*", relative (./, ../), and absolute imports are allowed',
      );
    }
  }
}

/**
 * Gated import of a TS config module: registers the virtual modules, pre-scans the imports
 * (colon-specifiers, relative, absolute only), and returns the module's default export — the
 * partial config the config boundary validates.
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
