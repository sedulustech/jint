/**
 * The extraction-count lock: the NUMBER of elements the query walker extracts from the parity
 * corpora (tests/fixtures/parity/<lang>/corpus.<ext>) is pinned per language, per capture. Any
 * walker or queries.scm change that shifts a count fails here and forces an explicit expectation
 * update - the committed answer to "we do not change the number of nodes extracted" across future
 * walker changes. The corpora double as the parity corpus (see that directory's README); change a
 * corpus only with the parity verdict re-recorded.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { decompose, type Capture, type WireCapture } from "./walk.ts";

const PARITY_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "parity",
);

/** Per language: corpus file and the pinned element count per capture (absent key = 0). */
const PINNED: Readonly<
  Record<
    string,
    {
      ext: string;
      definitions: Partial<Record<WireCapture, number>>;
      comments: Partial<Record<WireCapture, number>>;
      imports: Partial<Record<WireCapture, number>>;
    }
  >
> = {
  typescript: {
    ext: "ts",
    definitions: { type: 2, function: 4, binding: 2 },
    comments: {},
    imports: { import: 1 },
  },
  tsx: { ext: "tsx", definitions: { function: 2 }, comments: {}, imports: { import: 1 } },
  python: {
    ext: "py",
    definitions: { type: 1, function: 3 },
    comments: { comment: 3 },
    imports: { import: 1 },
  },
  go: { ext: "go", definitions: { type: 1, function: 2 }, comments: {}, imports: { import: 1 } },
  css: { ext: "css", definitions: {}, comments: { comment: 2 }, imports: {} },
  markdown: { ext: "md", definitions: { type: 2 }, comments: {}, imports: {} },
  c: {
    ext: "c",
    definitions: { type: 3, binding: 1, function: 3 },
    comments: { comment: 1 },
    imports: { import: 1 },
  },
  cpp: { ext: "cpp", definitions: { type: 4, function: 5 }, comments: {}, imports: { import: 1 } },
  php: {
    ext: "php",
    definitions: { type: 2, function: 3, binding: 3 },
    comments: {},
    imports: { import: 1 },
  },
  verilog: {
    ext: "sv",
    definitions: { type: 2, binding: 5, function: 1 },
    comments: {},
    imports: {},
  },
};

function counts(elements: readonly { capture: Capture }[]): Partial<Record<Capture, number>> {
  const out: Partial<Record<Capture, number>> = {};
  for (const e of elements) out[e.capture] = (out[e.capture] ?? 0) + 1;
  return out;
}

/** One line per bucket: "definitions function=4 type=2" - the ready-to-paste failure diff. */
function render(label: string, actual: Partial<Record<Capture, number>>): string {
  const pairs = Object.entries(actual)
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => k + "=" + String(n));
  return "  " + label + ": {" + (pairs.join(", ") || "empty") + "}";
}

describe("extraction counts - parity corpora pinned per language", () => {
  for (const [language, pin] of Object.entries(PINNED)) {
    test(language + ": corpus." + pin.ext + " extracts exactly the pinned counts", async () => {
      const source = await Bun.file(join(PARITY_DIR, language, "corpus." + pin.ext)).text();
      const inv = await decompose(source, language);

      const actual = {
        definitions: counts(inv.definitions),
        comments: counts(inv.comments),
        imports: counts(inv.imports),
      };
      const expected = {
        definitions: pin.definitions,
        comments: pin.comments,
        imports: pin.imports,
      };
      expect(actual).toEqual(expected);
    });
  }

  test("a count failure prints the ready-to-paste actual table", async () => {
    // The message contract of the pins above: on drift, the developer sees the new table and
    // updates PINNED explicitly - never silently.
    const source = await Bun.file(join(PARITY_DIR, "typescript", "corpus.ts")).text();
    const inv = await decompose(source, "typescript");
    const table = [
      render("definitions", counts(inv.definitions)),
      render("comments", counts(inv.comments)),
      render("imports", counts(inv.imports)),
    ].join("\n");
    expect(table).toContain("function=4");
  });
});
