import { describe, expect, test } from "bun:test";
import { capture, type CapturedElement } from "../../index.ts";

/**
 * The shared half of every <language>-shapes.test.ts: one synthetic corpus per grammar (beside its
 * test), one INVENTORY table pinning every element it yields in document order, and the deliberate
 * ABSENCES. Only the table and the corpus are per-language; the comparison lives here once, so a
 * grammar's test reads as the statement of its shapes and nothing else.
 *
 * Expected values come from what each construct SHOULD be (queries.scm, docs/captures.md,
 * docs/directives.md), never from a snapshot of the current output. Where the engine disagrees, the
 * row keeps the INTENDED values and carries `diverges`: the table then pins the current output so
 * the suite stays green, and a `test.failing` states the intended shape - it flips red the day the
 * engine is fixed, which is the cue to delete the `diverges` block.
 */

type Fields = Partial<Omit<Row, "id" | "diverges">>;

export interface Row {
  /** Names a row so another row can nest under it. */
  readonly id?: string;
  readonly kind: CapturedElement["kind"];
  /** 1-based line, 0-based column: the span's own shape in the report. */
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  readonly name?: string;
  /** The `id` of the enclosing row; omitted when the element sits at the top level. */
  readonly parent?: string;
  /** Comments only: whose documentation this is. Omitted means the engine reports no owner. */
  readonly owner?: "module" | readonly [kind: string, name: string];
  /**
   * The engine yields this element but should NOT: the table pins it (so the suite stays green) and
   * a `test.failing` asserts the intended absence.
   */
  readonly unwanted?: string;
  /** The engine's current output where it differs from the intended row above. */
  readonly diverges?: {
    readonly why: string;
    readonly actual: Fields | readonly Fields[] | "absent";
  };
}

/** A shape that must NOT produce an element: nothing (of `kinds`, if given) starts on `line`. */
export interface Absence {
  readonly line: number;
  readonly why: string;
  readonly kinds?: readonly CapturedElement["kind"][];
}

type Pos = readonly [number, number];
const at = (p: { line: number; column: number }): Pos => [p.line, p.column];
const sameAt = (a: Pos, b: Pos): boolean => a[0] === b[0] && a[1] === b[1];

/** Document order, an outer element before the one that starts where it starts. */
function documentOrder(elements: readonly CapturedElement[]): CapturedElement[] {
  return [...elements].sort(
    (a, b) =>
      a.span.start.line - b.span.start.line ||
      a.span.start.column - b.span.start.column ||
      b.span.end.line - a.span.end.line ||
      b.span.end.column - a.span.end.column,
  );
}

/** The rows the engine currently yields for one table row: usually itself, else its divergence. */
function effective(row: Row): Row[] {
  if (row.diverges === undefined) return [row];
  const { actual } = row.diverges;
  if (actual === "absent") return [];
  const list: readonly Fields[] = Array.isArray(actual) ? actual : [actual];
  return list.map((f) => ({ ...row, ...f, diverges: undefined }));
}

function diffOf(
  row: Row,
  e: CapturedElement | undefined,
  labelOf: (id: string) => string | undefined,
): string[] {
  if (e === undefined) return ["no element for " + row.kind + " at " + row.start.join(":")];
  const out: string[] = [];
  if (e.kind !== row.kind) out.push("kind " + e.kind + " != " + row.kind);
  if (!sameAt(at(e.span.start), row.start))
    out.push("start " + at(e.span.start).join(":") + " != " + row.start.join(":"));
  if (!sameAt(at(e.span.end), row.end))
    out.push("end " + at(e.span.end).join(":") + " != " + row.end.join(":"));
  if (e.name !== row.name) out.push("name " + String(e.name) + " != " + String(row.name));
  const parent = row.parent === undefined ? undefined : labelOf(row.parent);
  if (e.parent !== parent) out.push("parent " + String(e.parent) + " != " + String(parent));
  if (e.kind === "comment") {
    const owner = (e as { docstringOf?: { kind: string; name: string } }).docstringOf;
    const want =
      row.owner === undefined
        ? undefined
        : row.owner === "module"
          ? { kind: "module", name: "" }
          : { kind: row.owner[0], name: row.owner[1] };
    if (JSON.stringify(owner) !== JSON.stringify(want))
      out.push("owner " + JSON.stringify(owner) + " != " + JSON.stringify(want));
  }
  return out;
}

/** The corpus path: the fixture sits beside the test, named <language>-shapes.<ext>. */
export const fixturePath = (file: string): string => new URL(file, import.meta.url).pathname;

export function shapesSuite(
  language: string,
  file: string,
  inventory: readonly Row[],
  absences: readonly Absence[],
  captured: readonly CapturedElement[],
): void {
  const ordered = documentOrder(captured);
  const rows = inventory.flatMap(effective);
  const byId = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.id !== undefined) byId.set(r.id, i);
  });
  const labelOf = (id: string): string | undefined => {
    const i = byId.get(id);
    return i === undefined ? undefined : ordered[i]?.label;
  };

  describe(language + " shape corpus (" + file + "): the element contract, both ways", () => {
    test("the whole inventory: kind, exact span, name, parent and comment owner, document order", () => {
      expect(
        ordered.map((e) => e.kind),
        "element kinds, document order",
      ).toEqual(rows.map((r) => r.kind));
      rows.forEach((row, i) => {
        expect(
          diffOf(row, ordered[i], labelOf),
          "element " + String(i) + " (" + row.kind + ")",
        ).toEqual([]);
      });
    });

    test("the table has an id for every parent it names", () => {
      for (const r of inventory) {
        if (r.parent !== undefined) expect(inventory.some((x) => x.id === r.parent)).toBe(true);
      }
    });

    test("the deliberate absences: these shapes start no element", () => {
      for (const a of absences) {
        const hits = ordered
          .filter(
            (e) =>
              e.span.start.line === a.line && (a.kinds === undefined || a.kinds.includes(e.kind)),
          )
          .map((e) => e.kind);
        expect(hits, "line " + String(a.line) + ": " + a.why).toEqual([]);
      }
    });

    for (const row of inventory) {
      if (row.unwanted !== undefined) {
        test.failing("intended absence: " + row.unwanted, () => {
          const hits = ordered.filter(
            (e) => e.kind === row.kind && sameAt(at(e.span.start), row.start),
          );
          expect(hits.map((e) => e.kind)).toEqual([]);
        });
      }
      if (row.diverges === undefined) continue;
      // intended shape, expected to FAIL while the engine disagrees (bun reports a pass here as a
      // failure, so a fixed engine forces this row's `diverges` block to be deleted)
      test.failing("intended: " + row.diverges.why, () => {
        const hit = ordered.find((e) => e.kind === row.kind && sameAt(at(e.span.start), row.start));
        const labels = (id: string): string | undefined =>
          ordered.find((e) =>
            inventory.find((x) => x.id === id && sameAt(at(e.span.start), x.start)),
          )?.label;
        expect(diffOf(row, hit, labels), row.diverges?.why).toEqual([]);
      });
    }
  });
}

export const captureShapes = (file: string): Promise<CapturedElement[]> =>
  capture(fixturePath(file));
