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
// d34 = "Sibling section", d37 to d43 = the third to sixth levels) so nesting is pinned too.
const INVENTORY: readonly Row[] = [
  // the headingless preamble: its PARAGRAPH captures, its section never does (queries.scm: the
  // section carrier requires an atx_heading) - so this paragraph has no parent
  { kind: "paragraph", start: [1, 0], end: [2, 0] },
  // atx heading + everything under it: the section is the whole entry, named by
  // the heading text with the marker stripped, and it runs to EOF (L63)
  { kind: "h1.section", start: [3, 0], end: [63, 0], name: "Top section" },
  // the heading line alone, captured by its level, marks included: the first child of its section
  { kind: "h1", start: [3, 0], end: [4, 0], name: "Top section", parent: "d1" },
  { kind: "paragraph", start: [5, 0], end: [6, 0], parent: "d1" },
  // the wrapped paragraph: three source lines, ONE element, continuations inside the span
  { kind: "paragraph", start: [7, 0], end: [10, 0], parent: "d1" },
  // sections nest: the ## section is an element INSIDE the # section
  { kind: "h2.section", start: [11, 0], end: [50, 0], name: "Nested section", parent: "d1" },
  { kind: "h2", start: [11, 0], end: [12, 0], name: "Nested section", parent: "d5" },
  // a list is ONE element per bullet/ordered list, markers KEPT in its text; its span runs
  // through the trailing blank lines to the next block's start (ends [18,0] = the dash list)
  { kind: "list", start: [13, 0], end: [18, 0], parent: "d5" },
  // an entry is whole: its marker and the blank row under it included
  { kind: "list_item", start: [13, 0], end: [15, 0], parent: "d7" },
  // its paragraph is its text alone (col 3 = after "1. ")
  { kind: "paragraph", start: [13, 3], end: [14, 0], parent: "d8" },
  { kind: "list_item", start: [15, 0], end: [18, 0], parent: "d7" },
  // an indented continuation rides the paragraph, and its indent is left out of the text
  { kind: "paragraph", start: [15, 3], end: [17, 0], parent: "d10" },
  // the outer dash list: one element spanning all its items AND the nested list, ending at the
  // fence line (L27) - trailing blanks belong to the list that precedes them
  { kind: "list", start: [18, 0], end: [27, 0], parent: "d5" },
  { kind: "list_item", start: [18, 0], end: [19, 0], parent: "d12" },
  { kind: "paragraph", start: [18, 2], end: [19, 0], parent: "d13" },
  // dash two's tail continuation (L20) rides dash two - it never becomes dash three's prefix
  { kind: "list_item", start: [19, 0], end: [21, 0], parent: "d12" },
  { kind: "paragraph", start: [19, 2], end: [21, 0], parent: "d15" },
  { kind: "list_item", start: [21, 0], end: [23, 0], parent: "d12" },
  { kind: "paragraph", start: [21, 2], end: [22, 0], parent: "d17" },
  // a nested list sits inside its entry, boundary-coincident with it: the selfNesting case
  { kind: "list_item", start: [23, 0], end: [27, 0], parent: "d12" },
  { kind: "paragraph", start: [23, 2], end: [24, 2], parent: "d19" },
  { kind: "list", start: [24, 2], end: [27, 0], parent: "d19" },
  { kind: "list_item", start: [24, 2], end: [25, 2], parent: "d21" },
  { kind: "paragraph", start: [24, 4], end: [25, 2], parent: "d22" },
  { kind: "list_item", start: [25, 2], end: [27, 0], parent: "d21" },
  { kind: "paragraph", start: [25, 4], end: [26, 0], parent: "d24" },
  // a whole fence, its delimiter lines included
  { kind: "code_block", start: [27, 0], end: [30, 0], parent: "d5" },
  // the text inside the fence
  { kind: "code", start: [28, 0], end: [29, 0], parent: "d26" },
  { kind: "code_block", start: [31, 0], end: [34, 0], parent: "d5" },
  { kind: "code", start: [32, 0], end: [33, 0], parent: "d28" },
  // the pipe table: ONE element, header + delimiter row + body, ending where the next block starts
  { kind: "table", start: [35, 0], end: [38, 0], parent: "d5" },
  // blockquotes: the paragraph inside captures, its span starts after the first "> " (col 2), and
  // its text leaves out the "> " of every other line
  { kind: "paragraph", start: [41, 2], end: [42, 0], parent: "d5" },
  { kind: "paragraph", start: [43, 2], end: [45, 0], parent: "d5" },
  // inline code spans ride the paragraph text verbatim (backticks kept, no inline elements)
  { kind: "paragraph", start: [46, 0], end: [47, 0], parent: "d5" },
  // the LAST sibling section is boundary-coincident with its parent's tail: it starts exactly
  // where the nested section ended (L50 col 0) and runs to EOF - the selfNesting case
  { kind: "h2.section", start: [50, 0], end: [63, 0], name: "Sibling section", parent: "d1" },
  { kind: "h2", start: [50, 0], end: [51, 0], name: "Sibling section", parent: "d34" },
  { kind: "paragraph", start: [52, 0], end: [53, 0], parent: "d34" },
  // each deeper section nests in the one above, all boundary-coincident
  // with the file's end
  { kind: "h3.section", start: [54, 0], end: [63, 0], name: "Third level", parent: "d34" },
  { kind: "h3", start: [54, 0], end: [55, 0], name: "Third level", parent: "d37" },
  { kind: "h4.section", start: [56, 0], end: [63, 0], name: "Fourth level", parent: "d37" },
  { kind: "h4", start: [56, 0], end: [57, 0], name: "Fourth level", parent: "d39" },
  { kind: "h5.section", start: [58, 0], end: [63, 0], name: "Fifth level", parent: "d39" },
  { kind: "h5", start: [58, 0], end: [59, 0], name: "Fifth level", parent: "d41" },
  { kind: "h6.section", start: [60, 0], end: [63, 0], name: "Sixth level", parent: "d41" },
  { kind: "h6", start: [60, 0], end: [61, 0], name: "Sixth level", parent: "d43" },
  { kind: "paragraph", start: [62, 0], end: [63, 0], parent: "d43" },
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

  test("markdown emits the six section and heading levels, code, paragraph, list, list_item and table", () => {
    expect([...new Set(captured.map((e) => e.kind))].sort()).toEqual([
      "code",
      "code_block",
      "h1",
      "h1.section",
      "h2",
      "h2.section",
      "h3",
      "h3.section",
      "h4",
      "h4.section",
      "h5",
      "h5.section",
      "h6",
      "h6.section",
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

  test("a section's name is its heading text with the marker stripped, like its heading's", () => {
    for (const e of captured) {
      if (!/^h[1-6](\.section)?$/.test(e.kind)) continue;
      expect(e.name?.startsWith("#")).toBe(false);
      expect(e.name?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("a list entry keeps its marker, and its paragraph is its text alone", () => {
    const [item, paragraph] = captured.filter((e) => e.span.start.line === 19);
    expect(item!.text).toBe("- dash two with a tail\n  continuation under dash two\n");
    expect(paragraph!.text).toBe("dash two with a tail\ncontinuation under dash two\n");
  });

  test("a list owns one element, and a nested list sits inside the entry that holds it", () => {
    const lists = captured.filter((e) => e.kind === "list");
    expect(lists.map((e) => e.span.start.line)).toEqual([13, 18, 24]);
    expect(lists[1]!.text.startsWith("- dash one")).toBe(true);
    const holder = captured.find((e) => e.label === lists[2]!.parent)!;
    expect([holder.kind, holder.span.start.line]).toEqual(["list_item", 23]);
  });

  test("a blockquote strips every line's marker", () => {
    const quoted = captured.find((e) => e.span.start.line === 43)!;
    expect(quoted.text.startsWith("Multi-line quote that wraps")).toBe(true);
    expect(quoted.text).toContain("\nacross two lines.");
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
