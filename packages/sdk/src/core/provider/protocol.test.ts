import { describe, expect, test } from "bun:test";
import { foldCriteria, normalize, normalizeQuestion, unfoldCriteria } from "./protocol.ts";

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

describe("normalize", () => {
  test("the final line breaks of the content go, whichever form they take", () => {
    expect(normalize({ content: "a\nb\n" }).content).toBe("a\nb");
    expect(normalize({ content: "a\r\n\r\n" }).content).toBe("a");
    expect(normalize({ content: "a\nb" }).content).toBe("a\nb");
  });

  test("everything else in the content, and every other field, stays as written", () => {
    expect(normalize({ path: "a.ts", content: "a  \n\n  b  \n" })).toEqual({
      path: "a.ts",
      content: "a  \n\n  b  ",
    });
    expect(normalize({ path: "a.ts" })).toEqual({ path: "a.ts" });
  });
});

describe("normalize: element source", () => {
  test("the final line breaks of an element's source go, the rest stays", () => {
    expect(normalize({ source: "function a() {}  \n\n" }).source).toBe("function a() {}  ");
  });
});

describe("normalizeQuestion", () => {
  test("the spaces around the instructions and each criterion go", () => {
    expect(
      normalizeQuestion({
        type: "noul",
        instructions: "Is it? ",
        criteria: { true: "It is. ", false: " It is not.\n" },
      }),
    ).toEqual({
      type: "noul",
      instructions: "Is it?",
      criteria: { true: "It is.", false: "It is not." },
    });
  });

  test("spaces inside a text stay, and a list of criteria is trimmed item by item", () => {
    expect(
      normalizeQuestion({ type: "score", instructions: "A  b", criteria: [" low ", "high "] }),
    ).toEqual({ type: "score", instructions: "A  b", criteria: ["low", "high"] });
  });

  test("a question without criteria keeps none", () => {
    expect(normalizeQuestion({ type: "noul", instructions: "Is it? " })).toEqual({
      type: "noul",
      instructions: "Is it?",
    });
  });
});
