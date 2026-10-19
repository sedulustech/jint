import { describe, expect, test } from "bun:test";
import { capture, type CapturedElement } from "../../index.ts";

/**
 * THE markdown shape contract, pinned both ways over a synthetic corpus (markdown-shapes.md,
 * single-consumer fixture beside this test): every shape the grammar meets, one element inventory
 * asserting kind + exact span, and the deliberate ABSENCES (fenced code, tables, thematic breaks,
 * link references - transit under every mapping per the grammar's own queries.scm ledger).
 *
 * Why an exact inventory: an off-by-one span analysis once went unchallenged because no test stated
 * the expected shape. This table is that statement - a grammar patch that moves any boundary fails
 * here by line and column, and the absence rows fail if a transit shape starts capturing.
 */

const FIXTURE = new URL("./markdown-shapes.md", import.meta.url).pathname;

interface Row {
  readonly kind: CapturedElement["kind"];
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  readonly name?: string;
  readonly parent?: string;
}

// The whole inventory, document order. Line/column pairs are 1-based line, 0-based column - the
// span's own wire shape. parent references labels (d1 = "Top section", d4 = "Nested section",
// d16 = "Sibling section") so nesting is pinned too.
const INVENTORY: readonly Row[] = [
  // the headingless preamble: its PARAGRAPH captures, its section never does (queries.scm: the
  // section carrier requires an atx_heading) - so this paragraph has no parent
  { kind: "paragraph", start: [1, 0], end: [2, 0] },
  // atx heading + everything under it: the section is the whole entry, its name is the heading
  // text with the marker stripped, and it runs to EOF (L53)
  { kind: "section", start: [3, 0], end: [53, 0], name: "Top section" },
  { kind: "paragraph", start: [5, 0], end: [6, 0], parent: "d1" },
  // the wrapped paragraph: three source lines, ONE element, continuations inside the span
  { kind: "paragraph", start: [7, 0], end: [10, 0], parent: "d1" },
  // sections nest (selfNesting): the ## section is an element INSIDE the # section
  { kind: "section", start: [11, 0], end: [50, 0], name: "Nested section", parent: "d1" },
  // list items capture as paragraphs, marker stripped (col 3 = after "1. "), one element per item
  { kind: "paragraph", start: [13, 3], end: [14, 0], parent: "d4" },
  // the indented continuation rides the item's element (span through L17, text keeps the indent)
  { kind: "paragraph", start: [15, 3], end: [17, 0], parent: "d4" },
  // consecutive dash items with NO blank line: still one element each, marker stripped (col 2)
  { kind: "paragraph", start: [18, 2], end: [19, 0], parent: "d4" },
  // dash two's tail continuation (L20) rides dash two - it never becomes dash three's prefix
  { kind: "paragraph", start: [19, 2], end: [21, 0], parent: "d4" },
  { kind: "paragraph", start: [21, 2], end: [22, 0], parent: "d4" },
  // nested list: outer item ends at the inner list's first line (col 2), inner items start col 4
  { kind: "paragraph", start: [23, 2], end: [24, 2], parent: "d4" },
  { kind: "paragraph", start: [24, 4], end: [25, 2], parent: "d4" },
  { kind: "paragraph", start: [25, 4], end: [26, 0], parent: "d4" },
  // blockquotes: the paragraph inside captures, FIRST "> " marker stripped (col 2) - a
  // continuation line's "> " stays in the TEXT (only the opening marker belongs to the wrapper)
  { kind: "paragraph", start: [41, 2], end: [42, 0], parent: "d4" },
  { kind: "paragraph", start: [43, 2], end: [45, 0], parent: "d4" },
  // inline code spans ride the paragraph text verbatim (backticks kept, no inline elements)
  { kind: "paragraph", start: [46, 0], end: [47, 0], parent: "d4" },
  // the LAST sibling section is boundary-coincident with its parent's tail: it starts exactly
  // where the nested section ended (L50 col 0) and runs to EOF - the selfNesting case
  { kind: "section", start: [50, 0], end: [53, 0], name: "Sibling section", parent: "d1" },
  { kind: "paragraph", start: [52, 0], end: [53, 0], parent: "d16" },
];

describe("markdown shape corpus: the element contract, both ways", () => {
  test("the whole inventory: kind and exact span for every element, document order", () => {
    expect(captured.map((e) => e.kind)).toEqual(INVENTORY.map((r) => r.kind));
    for (let i = 0; i < INVENTORY.length; i++) {
      const row = INVENTORY[i]!;
      const e = captured[i]!;
      expect([e.span.start.line, e.span.start.column], "element " + String(i) + " start").toEqual([
        ...row.start,
      ]);
      expect([e.span.end.line, e.span.end.column], "element " + String(i) + " end").toEqual([
        ...row.end,
      ]);
      if (row.name !== undefined && e.kind === "section") expect(e.name).toBe(row.name);
      if (row.parent !== undefined) expect(e.parent).toBe(row.parent);
    }
  });

  test("markdown emits exactly two kinds - the grammar's own section and paragraph", () => {
    expect([...new Set(captured.map((e) => e.kind))].sort()).toEqual(["paragraph", "section"]);
  });

  test("a section's name is its heading text with the marker stripped", () => {
    for (const e of captured) {
      if (e.kind !== "section") continue;
      expect(e.name?.startsWith("#")).toBe(false);
      expect(e.name?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("a list item's marker is stripped; its continuation rides the same element", () => {
    const second = captured.find((e) => e.span.start.line === 15)!;
    expect(second.text.startsWith("Second ordered item")).toBe(true); // "2. " gone
    expect(second.text).toContain("\n   that belongs to the item"); // indent kept, same element
    const dashTwo = captured.find((e) => e.span.start.line === 19)!;
    expect(dashTwo.text.startsWith("dash two")).toBe(true); // "- " gone
    expect(dashTwo.text).toContain("\n  continuation under dash two");
  });

  test("a blockquote strips only the opening marker; later markers stay in the text", () => {
    const quoted = captured.find((e) => e.span.start.line === 43)!;
    expect(quoted.text.startsWith("Multi-line quote that wraps")).toBe(true);
    expect(quoted.text).toContain("\n> across two lines.");
  });

  test("inline code spans ride the paragraph text verbatim", () => {
    const para = captured.find((e) => e.span.start.line === 46)!;
    expect(para.text).toContain("Inline `code spans` ride");
  });

  // THE DELIBERATE ABSENCES (queries.scm transit ledger): fenced code (both fence styles), pipe
  // tables, thematic breaks, link reference definitions, and the atx heading itself produce NO
  // element - nothing starts on those fixture lines, and no element's span is the fence/table
  // body. If a future capture grows (the ledger's code-block candidate), these rows fail by name.
  test("transit shapes capture nothing: fences, tables, breaks, link references", () => {
    const transitLines = new Set<number>([
      ...range(27, 29), // ```ts fence (info string)
      ...range(31, 33), // ~~~ fence
      ...range(35, 37), // pipe table (header, delimiter, row)
      39, // thematic break
      48, // [ref]: link_reference_definition
    ]);
    for (const e of captured) {
      for (const line of transitLines) {
        expect(
          e.span.start.line === line,
          "element starts on transit line " + String(line) + ": " + e.kind,
        ).toBe(false);
      }
    }
    // the heading line starts a SECTION, never its own element
    expect(captured.filter((e) => e.span.start.line === 3).map((e) => e.kind)).toEqual(["section"]);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// module-scope capture: the fixture is read once, every assertion shares the one walk
const captured = await capture(FIXTURE);
