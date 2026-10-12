/**
 * Editor DX for the virtual module "jint:defaults" — the declarative default specs. The runtime
 * does NOT typecheck; this file exists so TS configs get completions and checking for the
 * colon-specifier (design config-composition/03). Separate from sdk.d.ts because the two modules
 * have separate owners: jint:sdk's contract is mirrored from sdk.ts by test, while jint:defaults
 * re-exports the @jint/defaults package's own types — the package is the source.
 */

declare module "jint:defaults" {
  export * from "@jint/defaults";
}
