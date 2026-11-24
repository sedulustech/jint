import { describe, expect, test } from "bun:test";
import { capture, type CapturedElement } from "../../index.ts";

/**
 * THE markdown shape contract, pinned both ways over a synthetic corpus (markdown-shapes.md,
 * single-consumer fixture beside this test): every shape the grammar meets, one element inventory
 * asserting kind + exact span, and the deliberate ABSENCES (thematic breaks and link references -
 * transit under every mapping per the grammar's own queries.scm ledger). A pipe table is one
 * element, whole.
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
// span's own shape in the report. parent references labels (d1 = "Top section", d5 = "Nested section",
// d26 = "Sibling section", d29 to d35 = the third to sixth levels) so nesting is pinned too.
const INVENTORY: readonly Row[] = [
  // the headingless preamble: its PARAGRAPH captures, its section never does (queries.scm: the
  // section carrier requires an atx_heading) - so this paragraph has no parent
  { kind: "paragraph", start: [1, 0], end: [2, 0] },
  // atx heading + everything under it: the section is the whole entry, captured by its level (#
  // = h1), named by the heading text with the marker stripped, and it runs to EOF (L63)
  { kind: "h1", start: [3, 0], end: [63, 0], name: "Top section" },
  // the heading line alone, marks included: the first child of its section
  { kind: "heading", start: [3, 0], end: [4, 0], parent: "d1" },
  { kind: "paragraph", start: [5, 0], end: [6, 0], parent: "d1" },
  // the wrapped paragraph: three source lines, ONE element, continuations inside the span
  { kind: "paragraph", start: [7, 0], end: [10, 0], parent: "d1" },
  // sections nest: the ## section (h2) is an element INSIDE the # section (h1)
  { kind: "h2", start: [11, 0], end: [50, 0], name: "Nested section", parent: "d1" },
  { kind: "heading", start: [11, 0], end: [12, 0], parent: "d5" },
  // a list is ONE element per bullet/ordered list, markers KEPT in its text; its span runs
  // through the trailing blank lines to the next block's start (ends [18,0] = the dash list)
  { kind: "list", start: [13, 0], end: [18, 0], parent: "d5" },
  // list_item: the paragraph inside the entry, marker stripped (col 3 = after "1. "), one per item
  { kind: "list_item", start: [13, 3], end: [14, 0], parent: "d7" },
  // the indented continuation rides the item's element (span through L17, text keeps the indent)
  { kind: "list_item", start: [15, 3], end: [17, 0], parent: "d7" },
  // the outer dash list: one element spanning all its items AND the nested list, ending at the
  // fence line (L27) - trailing blanks belong to the list that precedes them
  { kind: "list", start: [18, 0], end: [27, 0], parent: "d5" },
  // consecutive dash items with NO blank line: still one element each, marker stripped (col 2)
  { kind: "list_item", start: [18, 2], end: [19, 0], parent: "d10" },
  // dash two's tail continuation (L20) rides dash two - it never becomes dash three's prefix
  { kind: "list_item", start: [19, 2], end: [21, 0], parent: "d10" },
  { kind: "list_item", start: [21, 2], end: [22, 0], parent: "d10" },
  // the outer item's text ends where the inner list begins (col 2); the inner list is an
  // element of its OWN (lists nest legitimately), boundary-coincident with its outer list's
  // end [27,0] - the selfNesting case sections already pinned, now for lists too
  { kind: "list_item", start: [23, 2], end: [24, 2], parent: "d10" },
  { kind: "list", start: [24, 2], end: [27, 0], parent: "d10" },
  { kind: "list_item", start: [24, 4], end: [25, 2], parent: "d15" },
  { kind: "list_item", start: [25, 4], end: [26, 0], parent: "d15" },
  // a whole fence, its delimiter lines included
  { kind: "code_block", start: [27, 0], end: [30, 0], parent: "d5" },
  // the text inside the fence
  { kind: "code", start: [28, 0], end: [29, 0], parent: "d18" },
  { kind: "code_block", start: [31, 0], end: [34, 0], parent: "d5" },
  { kind: "code", start: [32, 0], end: [33, 0], parent: "d20" },
  // the pipe table: ONE element, header + delimiter row + body, ending where the next block starts
  { kind: "table", start: [35, 0], end: [38, 0], parent: "d5" },
  // blockquotes: the paragraph inside captures, FIRST "> " marker stripped (col 2) - a
  // continuation line's "> " stays in the TEXT (only the opening marker belongs to the wrapper)
  { kind: "paragraph", start: [41, 2], end: [42, 0], parent: "d5" },
  { kind: "paragraph", start: [43, 2], end: [45, 0], parent: "d5" },
  // inline code spans ride the paragraph text verbatim (backticks kept, no inline elements)
  { kind: "paragraph", start: [46, 0], end: [47, 0], parent: "d5" },
  // the LAST sibling section is boundary-coincident with its parent's tail: it starts exactly
  // where the nested section ended (L50 col 0) and runs to EOF - the selfNesting case
  { kind: "h2", start: [50, 0], end: [63, 0], name: "Sibling section", parent: "d1" },
  { kind: "heading", start: [50, 0], end: [51, 0], parent: "d26" },
  { kind: "paragraph", start: [52, 0], end: [53, 0], parent: "d26" },
  // one capture per level: each deeper heading nests in the one above, all boundary-coincident
  // with the file's end
  { kind: "h3", start: [54, 0], end: [63, 0], name: "Third level", parent: "d26" },
  { kind: "heading", start: [54, 0], end: [55, 0], parent: "d29" },
  { kind: "h4", start: [56, 0], end: [63, 0], name: "Fourth level", parent: "d29" },
  { kind: "heading", start: [56, 0], end: [57, 0], parent: "d31" },
  { kind: "h5", start: [58, 0], end: [63, 0], name: "Fifth level", parent: "d31" },
  { kind: "heading", start: [58, 0], end: [59, 0], parent: "d33" },
  { kind: "h6", start: [60, 0], end: [63, 0], name: "Sixth level", parent: "d33" },
  { kind: "heading", start: [60, 0], end: [61, 0], parent: "d35" },
  { kind: "paragraph", start: [62, 0], end: [63, 0], parent: "d35" },
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
      if (row.name !== undefined) expect(e.name).toBe(row.name);
      if (row.parent !== undefined) expect(e.parent).toBe(row.parent);
    }
  });

  test("markdown emits the six heading levels, heading, code, paragraph, list, list_item and table", () => {
    expect([...new Set(captured.map((e) => e.kind))].sort()).toEqual([
      "code",
      "code_block",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "heading",
      "list",
      "list_item",
      "paragraph",
      "table",
    ]);
  });

  test("a pipe table is one element holding its header, delimiter row and body", () => {
    const tables = captured.filter((e) => e.kind === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.text.trim()).toBe("| col a | col b |\n| ----- | ----- |\n| 1     | 2     |");
  });

  test("a section's name is its heading text with the marker stripped", () => {
    for (const e of captured) {
      if (!/^h[1-6]$/.test(e.kind)) continue;
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

  test("a list keeps its markers and owns one element per list; items never double-capture", () => {
    const lists = captured.filter((e) => e.kind === "list");
    expect(lists.map((e) => e.span.start.line)).toEqual([13, 18, 24]);
    // the list's TEXT keeps the markers ("- dash one" opens the outer list); only the item's
    // own element strips them - the container shows the shape, the entry shows the prose
    expect(lists[1]!.text.startsWith("- dash one")).toBe(true);
    // in-list paragraphs are list_item, NEVER paragraph: the loose prose pattern enumerates its
    // parents (section-direct, block_quote) and the list_item parent belongs to the entry capture
    const inList = captured.filter((e) => e.span.start.line >= 13 && e.span.start.line <= 25);
    expect(inList.every((e) => e.kind === "list" || e.kind === "list_item")).toBe(true);
    // the nested list is an element of its own, parented by the OUTER LIST (the outer item's
    // element is its paragraph, which does not contain the inner list)
    const inner = lists[2]!;
    expect([inner.span.start.line, inner.span.end.line]).toEqual([24, 27]);
    expect(inner.parent).toBe("d10");
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

  // THE DELIBERATE ABSENCES (queries.scm transit ledger): thematic breaks and link
  // reference definitions produce NO element - nothing starts on those fixture lines. If a future
  // capture grows, these rows fail by name.
  test("transit shapes capture nothing: breaks, link references", () => {
    const transitLines = new Set<number>([
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
  });
});

// module-scope capture: the fixture is read once, every assertion shares the one walk
const captured = await capture(FIXTURE);
