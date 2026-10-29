import { describe, expect, test } from "bun:test";
import { foldCriteria, unfoldCriteria } from "./protocol.ts";

describe("foldCriteria / unfoldCriteria", () => {
  const cases: [string, Record<string, string>][] = [
    ["both meanings", { true: "it holds", false: "it does not" }],
    ["only a yes", { true: "it holds" }],
    ["only a no", { false: "it does not" }],
    ["meanings of several lines", { true: "first\nsecond", false: "third\nfourth" }],
    [
      "a meaning that mentions the other label",
      { true: "says Yes: or No: in a comment", false: "n" },
    ],
  ];

  test.each(cases)("what was folded unfolds to the same: %s", (_label, criteria) => {
    const folded = foldCriteria("Is it?", criteria);
    expect(unfoldCriteria(folded)).toEqual({ instructions: "Is it?", criteria });
  });

  test("no criteria fold to the instructions alone, and unfold to the instructions alone", () => {
    expect(foldCriteria("Is it?", {})).toBe("Is it?");
    expect(unfoldCriteria("Is it?")).toEqual({ instructions: "Is it?" });
  });

  test("instructions of several paragraphs keep them", () => {
    const folded = foldCriteria("One.\n\nTwo.", { true: "a", false: "b" });
    expect(unfoldCriteria(folded)).toEqual({
      instructions: "One.\n\nTwo.",
      criteria: { true: "a", false: "b" },
    });
  });
});
