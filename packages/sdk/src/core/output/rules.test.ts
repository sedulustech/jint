import { describe, test, expect } from "bun:test";
import { defaultRules } from "../../../tests/test-baseline.ts";
import { describeRule, describeRules } from "./rules.ts";
import type { Rule } from "../types.ts";

/** Hand-built fixtures — every rule kind the renderer branches on; no defaults coupling. */
const noulRule: Rule = {
  name: "fixture_pins_artifacts",
  target: "comments",
  instructions: "Does any comment pin artifacts by name?",
  criteria: {
    true: "At least one comment pins artifacts — rename breaks it.",
    false: "No comment is coupled to identifiers.",
  },
  handle: () => null,
  handleData: { warn: { greater_than: 0.55 }, error: { greater_than: 0.7 } },
};

const choiceRule: Rule = {
  kind: "choice",
  name: "fixture_effort",
  target: "definitions",
  instructions: "How much effort does a reader need?",
  criteria: ["Easy: linear.", "Moderate: pause once.", "Hard: reconstruct the flow."],
  handle: () => null,
  handleData: { map: ["pass", "warn", "error"] },
};

const bareRule: Rule = {
  name: "fixture_measure_only",
  target: "files",
  instructions: "Does anything happen at all?",
  criteria: { true: "yes", false: "no" },
  handle: () => null, // no handleData -> "no handle (measurement only)"
};

describe("describeRule", () => {
  test("noul: name, target, thresholds, question, both criteria sides", () => {
    const block = describeRule(noulRule);
    expect(block).toContain("fixture_pins_artifacts  [comments]");
    expect(block).toContain("warn > 0.55 · error > 0.7");
    expect(block).toContain("asks: Does any comment pin artifacts by name?");
    expect(block).toContain("1  At least one comment pins artifacts — rename breaks it.");
    expect(block).toContain("0  No comment is coupled to identifiers.");
  });

  test("choice: level map + ordered rubric, no 1/0", () => {
    const block = describeRule(choiceRule);
    expect(block).toContain("fixture_effort  [definitions]");
    expect(block).toContain("level map: pass / warn / error");
    expect(block).toContain("asks: How much effort does a reader need?");
    expect(block).toContain("0  Easy: linear.");
    expect(block).toContain("1  Moderate: pause once.");
    expect(block).toContain("2  Hard: reconstruct the flow.");
    expect(block).not.toContain("level map: pass / warn / error ·");
  });

  test("rule without handleData names itself as measurement-only", () => {
    expect(describeRule(bareRule)).toContain("no handle (measurement only)");
  });
});

describe("describeRules", () => {
  test("deterministic: same input, byte-identical block", () => {
    const a = describeRules([noulRule, choiceRule, bareRule]);
    const b = describeRules([noulRule, choiceRule, bareRule]);
    expect(a).toBe(b);
  });

  test("defaults: every rule renders with name, question, and both criteria sides — nothing trimmed", () => {
    const all = Object.values(defaultRules) as Rule[];
    const block = describeRules(all);
    for (const rule of all) {
      expect(block).toContain(rule.name);
      if ("instructions" in rule && rule.instructions !== undefined)
        expect(block).toContain("asks: " + rule.instructions);
      if ("criteria" in rule) {
        // "in" narrows the union (readonly tuples never narrow out of an Array.isArray else):
        // exactly the renderer's own discriminant.
        if ("true" in rule.criteria) {
          expect(block).toContain(rule.criteria.true);
          expect(block).toContain(rule.criteria.false);
        } else {
          for (const level of rule.criteria) expect(block).toContain(level);
        }
      }
    }
    // The feature's core invariant: the block carries one question per rule, no more, no less.
    expect(block.match(/asks: /g)?.length).toBe(all.length);
  });
});
