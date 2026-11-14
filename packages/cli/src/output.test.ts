import { describe, expect, test } from "bun:test";
import { captureJson, captureJsonChunks } from "./output.ts";
import type { CapturedElement } from "@jint/sdk";

const element = (name: string, text: string): CapturedElement =>
  ({
    kind: "function",
    name,
    label: "d0",
    span: {
      start: { line: 1, column: 0 },
      end: { line: 2, column: 1 },
      startByte: 0,
      endByte: 9,
    },
    input: "a.ts",
    grammar: "typescript",
    text,
  }) as CapturedElement;

describe("capture --json", () => {
  const sets: readonly (readonly [string, readonly CapturedElement[]])[] = [
    ["no elements", []],
    ["one element", [element("a", "function a() {}")]],
    [
      "several elements, text with quotes, newlines and unicode",
      [element("a", 'x = "q"\n\ty'), element("b", "naïve ✓"), element("c", "")],
    ],
  ];
  for (const [label, elements] of sets) {
    test(`the pieces join to exactly the document JSON.stringify makes: ${label}`, () => {
      expect(captureJson(elements)).toBe(JSON.stringify({ elements }, null, 2) + "\n");
      expect([...captureJsonChunks(elements)].join("")).toBe(captureJson(elements));
    });
  }

  test("each element is its own piece, so no piece holds the whole document", () => {
    const elements = [element("a", "1"), element("b", "2"), element("c", "3")];
    expect([...captureJsonChunks(elements)]).toHaveLength(elements.length + 2);
  });
});
