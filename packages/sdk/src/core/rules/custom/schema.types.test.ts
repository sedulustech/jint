/**
 * The "jint:sdk" editor types (sdk.d.ts) are inline imports, and skipLibCheck turns one that does
 * not resolve into `any` in silence. An `any` accepts a symbol, so the line that expects a refusal
 * then fails the typecheck.
 */

/// <reference path="../../../sdk.d.ts" />

import { expect, test } from "bun:test";
import type * as dx from "jint:sdk";

const refused = Symbol("not a jint:sdk type");

const types: readonly unknown[] = [
  // @ts-expect-error
  refused satisfies dx.CustomElement,
  // @ts-expect-error
  refused satisfies dx.RuleContext,
  // @ts-expect-error
  refused satisfies dx.CustomFile,
  // @ts-expect-error
  refused satisfies dx.StateSchema,
  // @ts-expect-error
  refused satisfies dx.CustomHandleData,
  // @ts-expect-error
  refused satisfies dx.CustomDecision,
  // @ts-expect-error
  refused satisfies dx.ComposeState,
  // @ts-expect-error
  refused satisfies dx.ComposedQuestion,
  // @ts-expect-error
  refused satisfies dx.ClassifiedQuestion,
  // @ts-expect-error
  refused satisfies dx.CustomRule,
  // @ts-expect-error
  refused satisfies dx.TsConfig,
  // @ts-expect-error
  refused satisfies dx.RuleResult,
  // @ts-expect-error
  refused satisfies dx.RuleSchema,
];

test("every jint:sdk type resolves", () => {
  expect(types).toHaveLength(13);
});
