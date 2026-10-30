/**
 * Editor DX for the virtual modules "jint:rules/<domain>": one per domain package, each
 * re-exporting the package's own types and rules - the package is the source. The runtime does NOT
 * typecheck; this file exists so TS configs get completions and checking for the colon-specifiers.
 * Separate from sdk.d.ts because the owners differ: jint:sdk's contract is mirrored from
 * custom/schema.ts by test, while each domain re-exports its own package.
 */

declare module "jint:rules/comments" {
  export * from "@jint/rules-comments";
}
declare module "jint:rules/complexity" {
  export * from "@jint/rules-complexity";
}
declare module "jint:rules/errors" {
  export * from "@jint/rules-errors";
}
declare module "jint:rules/naming" {
  export * from "@jint/rules-naming";
}
