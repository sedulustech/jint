import { describe, expect, test } from "bun:test";
import { captureJsonChunks } from "./output.ts";
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

async function pieces(
  source: AsyncIterable<readonly CapturedElement[]> | Iterable<readonly CapturedElement[]>,
) {
  const all: string[] = [];
  for await (const piece of captureJsonChunks(source)) all.push(piece);
  return all;
}

async function* oneFileAtATime(elements: readonly CapturedElement[]) {
  for (const e of elements) yield [e];
}

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
    test(`the pieces join to exactly the document JSON.stringify makes: ${label}`, async () => {
      const expected = JSON.stringify({ elements }, null, 2) + "\n";
      expect((await pieces([elements])).join("")).toBe(expected);
      expect((await pieces(oneFileAtATime(elements))).join("")).toBe(expected);
    });
  }

  test("each file is its own piece, and a file with no elements adds none", async () => {
    const files = [[element("a", "1")], [], [element("b", "2"), element("c", "3")]];
    expect(await pieces(files)).toHaveLength(2 + 1);
  });
});
