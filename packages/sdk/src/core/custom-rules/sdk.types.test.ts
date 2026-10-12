/**
 * Drift guard for the "jint:sdk" editor types (sdk.d.ts): the d.ts is an ambient declaration, so a
 * relative re-export cannot resolve there (and skipLibCheck would hide the failure) — the mapping
 * is hand-written. This test makes the mirror COMPILE-CHECKED instead: any field added to or
 * removed from the live sdk.ts types breaks the type-identity assertions below at typecheck time.
 *
 * Note: only tsc runs this contract — bun's transform strips types. That is exactly the point: the
 * file is green at runtime and loud in `bun run typecheck`.
 */

/// <reference path="./sdk.d.ts" />

import { describe, expect, test } from "bun:test";
import type {
  RuleContext,
  StateSpec,
  TsConfig,
  CustomDecision,
  CustomElement,
  CustomHandleData,
  CustomRule,
} from "./sdk.ts";
import type {
  RuleContext as DxRuleContext,
  StateSpec as DxStateSpec,
  TsConfig as DxTsConfig,
  CustomDecision as DxCustomDecision,
  CustomElement as DxCustomElement,
  CustomHandleData as DxCustomHandleData,
  CustomRule as DxCustomRule,
} from "jint:sdk";

/** Type identity, not assignability: <T>() => T extends A ? 1 : 2 distinguishes even optionals. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Contract = [
  Expect<Same<CustomElement, DxCustomElement>>,
  Expect<Same<RuleContext, DxRuleContext>>,
  Expect<Same<StateSpec, DxStateSpec>>,
  Expect<Same<CustomHandleData, DxCustomHandleData>>,
  Expect<Same<CustomDecision, DxCustomDecision>>,
  Expect<Same<CustomRule, DxCustomRule>>,
  Expect<Same<TsConfig, DxTsConfig>>,
];
const _contract: Contract = [true, true, true, true, true, true, true];

describe("sdk.d.ts mirror (jint:sdk editor types)", () => {
  test("the ambient declaration is type-identical to the live sdk.ts contract (see Contract)", () => {
    // The assertion lives in the type system: _contract only typechecks when the d.ts mirror
    // matches sdk.ts exactly. Kept non-empty so noUnusedLocals-style lints never drop it.
    expect(_contract).toHaveLength(7);
  });
});
