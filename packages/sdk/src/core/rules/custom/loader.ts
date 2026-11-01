import { readFileSync } from "node:fs";
import { SetupError } from "../../types.ts";
import { defineConfig } from "./schema.ts";

let sdkRegistered = false;
const registeredDomains = new Map<string, string[]>();

/**
 * Registers the virtual modules: "jint:sdk" (the rule-author API) once per process, and one
 * "jint:rules/<domain>" per domain the entry point supplies (the DECLARATIVE specs - never compiled
 * Rule objects; design config-composition/03). A domain's key is its import path under jint:rules/,
 * so a nested domain registers as "comments/typescript". build.module intercepts before any disk
 * lookup, so these resolve inside compiled binaries too, and external users need no install. The
 * scheme specifier is the PORTABLE config-facing spelling; bare @jint/* stays a workspace package
 * form and is NOT intercepted - the design doc on config import specifiers records the
 * deliberation. Calls are cumulative: a domain registers once, the first time its key is supplied.
 */
export function registerCustomRuleLoader(
  virtuals: { domains?: Readonly<Record<string, readonly unknown[]>> } = {},
): void {
  const fresh = Object.entries(virtuals.domains ?? {}).filter(
    ([key]) => !registeredDomains.has(key),
  );
  if (sdkRegistered && fresh.length === 0) return;
  for (const [key, specs] of fresh) {
    registeredDomains.set(
      key,
      specs.map((spec) => (spec as { name: string }).name),
    );
  }
  const registerSdk = !sdkRegistered;
  sdkRegistered = true;
  Bun.plugin({
    name: "jint-rules",
    setup(build) {
      if (registerSdk) {
        build.module("jint:sdk", () => ({
          exports: { defineConfig },
          loader: "object",
        }));
      }
      // The surface mirrors the domain package: each rule under its own name (the pick-and-override
      // consumption: { ...is_greppable, include: ["src/**"] }) plus the whole domain as `rules`.
      for (const [key, specs] of fresh) {
        build.module("jint:rules/" + key, () => ({
          exports: {
            ...Object.fromEntries(specs.map((spec) => [(spec as { name: string }).name, spec])),
            rules: specs,
          },
          loader: "object",
        }));
      }
    },
  });
}

/** The domains registered so far: the import path under jint:rules/ -> the rule names it holds. */
export function registeredRuleDomains(): Record<string, string[]> {
  return Object.fromEntries(
    [...registeredDomains.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * What a config with no rules is told: the domains a config can import from and the rules each
 * holds, with the smallest working config. Written for the agent that reads the error and writes
 * the config - every name it needs is in the message.
 */
export function noRulesAdvice(): string {
  const domains = registeredRuleDomains();
  const listing = Object.entries(domains)
    .map(([key, names]) => `  jint:rules/${key}: ${names.join(", ")}`)
    .join("\n");
  const first = Object.entries(domains)[0];
  const example =
    first === undefined
      ? ""
      : `\nexample jint.config.ts:\n  import { ${first[1][0]} } from "jint:rules/${first[0]}";\n  import { defineConfig } from "jint:sdk";\n  export default defineConfig({ rules: { use: [${first[1][0]}] } });\nA jint.config.json names a rule as a string: { "rules": { "use": ["${first[1][0]}"] } }.`;
  return (
    "pick the rules to run from the domains below" +
    (listing === "" ? "" : "\n" + listing) +
    example
  );
}

/**
 * True when a scanned import may pass the gate: a jint:* virtual module, or a relative/absolute
 * file. Bare npm specifiers and node:* builtins stay rejected - the sandbox line is unchanged.
 */
function allowedImport(specifier: string): boolean {
  return (
    specifier.startsWith("jint:") ||
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
    // an import of a domain that does not exist resolves to nothing: name the ones that do
    const unknownDomain = detail.match(/Cannot find package '(jint:rules[^']*)'/);
    const hint = unknownDomain !== null ? ` - unknown rule domain; ${noRulesAdvice()}` : "";
    throw new SetupError(
      "CONFIG_INVALID",
      "config module failed to load: " + abs + ": " + detail + hint,
      {
        cause: thrown,
      },
    );
  }
}
