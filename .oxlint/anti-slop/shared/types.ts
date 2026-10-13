import type { ESTree } from "@oxlint/plugins";

type WideningTargetKind =
  | "anonymous object"
  | "generic container"
  | "object"
  | "open dictionary"
  | "unknown";

export type WideningTarget = {
  readonly kind: WideningTargetKind;
  /**
   * Member keys of an anonymous-object target (a type literal without an index signature). Lets
   * callers tell a key-preserving structural annotation — one whose keys exactly match the
   * initializer — from a genuinely broad target that discards members.
   */
  readonly keys?: readonly string[];
};

export type TypeEnvironment = {
  readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
};
