import { describe, expect, test } from "bun:test";
import { elementContent, matchesTarget } from "../rules/classify.ts";
import { knownLanguages } from "./grammars.ts";
import { decompose } from "./walk.ts";

// The comment-target PAIR split, verified over ALL TEN embedded grammars: `comments` and
// `loose-comments` must be disjoint and jointly exhaustive over comment text - every comment a
// grammar extracts is measured under exactly one target, owned ones through their definition's
// pair frame, unowned ones as loose elements. A comment shape in neither bucket is a bug.
// Markdown captures no comments at all (the design's WAITING ledger) - recorded absence,
// asserted explicitly rather than skipped.

const SOURCES: Record<string, string> = {
  c: "// c doc\nint add(int a, int b) {\n  // inline note\n  return a + b;\n}\n\n// c loose\n",
  cpp: "// cpp doc\nint add(int a, int b) {\n  // inline note\n  return a + b;\n}\n\n// cpp loose\n",
  css: "/* css doc, no definitions in css */\nbody { color: red; }\n\n/* css loose */\n",
  go: "package p\n\n// go doc\nfunc Add(a int) int {\n  // inline note\n  return a\n}\n\n// go loose\n",
  markdown: "# Title\n\nSome prose. Markdown has no comment capture (WAITING ledger).\n",
  php: "<?php\n// php doc\nfunction add($a) {\n  // inline note\n  return $a;\n}\n\n// php loose\n",
  python:
    '# py doc\ndef add(a):\n    """Adds a."""\n    # inline note\n    return a\n\n# py loose\n',
  tsx: "// tsx doc\nexport function add(a: number): number {\n  // inline note\n  return a;\n}\n\n// tsx loose\n",
  typescript:
    "// ts doc\nexport function add(a: number): number {\n  // inline note\n  return a;\n}\n\n// ts loose\n",
};

describe("comment-target pair split across all nine grammars", () => {
  test("every grammar is registered with a probe source", () => {
    expect(Object.keys(SOURCES).sort()).toEqual([...knownLanguages()].sort());
  });

  for (const language of knownLanguages()) {
    test(language + ": disjoint and jointly exhaustive over comment text", async () => {
      const inv = await decompose(SOURCES[language]!, language);
      const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
      const commentsPicks = elements.filter((e) => matchesTarget("comments", e));
      const loosePicks = elements.filter((e) => matchesTarget("loose-comments", e));

      // DISJOINT: no element serves both buckets
      for (const e of elements) {
        expect(matchesTarget("comments", e) && matchesTarget("loose-comments", e)).toBe(false);
      }

      // JOINTLY EXHAUSTIVE over comment text: each extracted comment text is covered exactly
      // once - inside exactly one pair frame (attachedComment or the frame's own source), or as
      // exactly one loose element.
      const texts = inv.comments.map((c) => c.content);
      for (const text of texts) {
        const inFrame = commentsPicks.filter(
          (e) =>
            e.attachedComment?.includes(text) ||
            e.docstrings?.includes(text) ||
            e.content.includes(text),
        ).length;
        const loose = loosePicks.filter((e) => e.content === text).length;
        expect(inFrame + loose, "comment not covered exactly once: " + text).toBe(1);
      }

      // the trailing standalone comment is loose in every grammar that extracts comments
      const looseSuffix = SOURCES[language]!.split("\n").at(-2);
      if (texts.length > 0) {
        expect(
          loosePicks.some((e) => e.content === looseSuffix),
          language + ": the standalone comment must be loose",
        ).toBe(true);
      }
    });

    test(
      language + ": a documented definition draws the pair frame ONCE (no double fire)",
      async () => {
        if (language === "css" || language === "markdown") return; // no definitions / no comments
        const inv = await decompose(SOURCES[language]!, language);
        const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
        // the leading doc comment text appears in exactly one comments-target frame
        const docText = inv.comments[0]!.content;
        const frames = elements.filter(
          (e) => matchesTarget("comments", e) && (e.attachedComment?.includes(docText) ?? false),
        );
        // and no owned comment element is a separate comments match
        const elementDouble = elements.filter(
          (e) =>
            e.capture === "comment" &&
            e.docstringOf !== undefined &&
            e.docstringOf.kind !== "module" &&
            matchesTarget("comments", e),
        );
        expect(frames).toHaveLength(1);
        expect(elementDouble).toHaveLength(0);
      },
    );
  }

  test("markdown: no comment capture - recorded absence, nothing escapes into either bucket", async () => {
    const inv = await decompose(SOURCES.markdown!, "markdown");
    expect(inv.comments).toHaveLength(0);
  });

  test("css: no definitions, so every extracted comment is loose", async () => {
    const inv = await decompose(SOURCES.css!, "css");
    const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
    expect(inv.definitions).toHaveLength(0);
    expect(inv.comments.length).toBeGreaterThan(0);
    for (const e of elements) {
      expect(matchesTarget("loose-comments", e)).toBe(true);
      expect(matchesTarget("comments", e)).toBe(false);
    }
  });
});
describe("the docstring pair frame (BYOG field trial regression)", () => {
  // The rust-convention shape, on an embedded grammar: a LEADING doc comment the .scm may capture
  // either as a plain attached run or as @docstring with owner next. Both captures must compose
  // the SAME measured frame - the field trial measured them diverging (0.16 vs 0.32 on
  // codex-rs/ansi-escape): the docstring counted for the definition while its text never reached
  // the classifier.
  const LEADING_DOC_SRC = [
    "/** Expands tabs for transcript rendering.",
    " * Tabs interact poorly with gutter prefixes.",
    " */",
    "export function expandTabs(s: string): string {",
    "  // fixed substitution: no tab-stop math",
    '  return s.replace("\\t", "    ");',
    "}",
    "",
  ].join("\n");

  const SCM_AS_RUN = [
    "(function_declaration name: (identifier) @name) @function",
    "(comment) @comment",
    "",
  ].join("\n");

  const SCM_AS_DOCSTRING = [
    "(function_declaration name: (identifier) @name) @function",
    '((comment) @docstring (#set! "docstring.owner" "next"))',
    "",
  ].join("\n");

  test("a leading doc as @docstring composes the same frame as the same doc as an attached run", async () => {
    const asRun = await decompose(LEADING_DOC_SRC, "typescript", { queries: SCM_AS_RUN });
    const asDocstring = await decompose(LEADING_DOC_SRC, "typescript", {
      queries: SCM_AS_DOCSTRING,
    });
    const fnRun = asRun.definitions.find((d) => d.name === "expandTabs");
    const fnDoc = asDocstring.definitions.find((d) => d.name === "expandTabs");
    expect(fnRun).toBeDefined();
    expect(fnDoc).toBeDefined();
    // both captures make the definition a comments-target match
    expect(matchesTarget("comments", fnRun!)).toBe(true);
    expect(matchesTarget("comments", fnDoc!)).toBe(true);
    // and both compose the IDENTICAL measured frame - the doc text is no longer silent
    expect(elementContent(fnDoc!)).toBe(elementContent(fnRun!));
    expect(elementContent(fnDoc!)).toContain("Expands tabs for transcript rendering.");
  });

  test("run lines join with single newlines (no blank line between run lines)", async () => {
    const src = [
      "// first run line",
      "// second run line",
      "export function add(a: number): number {",
      "  return a;",
      "}",
      "",
    ].join("\n");
    const inv = await decompose(src, "typescript", { queries: SCM_AS_RUN });
    const fn = inv.definitions.find((d) => d.name === "add")!;
    const frame = elementContent(fn);
    expect(frame).not.toContain("\n\n");
    expect(frame.startsWith("// first run line\n// second run line\nfunction")).toBe(true);
  });

  test("python: a body docstring rides content exactly once (never the docstrings texts)", async () => {
    const inv = await decompose(SOURCES.python!, "python");
    const fn = inv.definitions.find((d) => d.name === "add")!;
    expect(fn.docstrings).toBeUndefined();
    expect(fn.docstringCount).toBe(1);
    expect(matchesTarget("comments", fn)).toBe(true);
    const frame = elementContent(fn);
    expect(frame.match(/Adds a\./g)).toHaveLength(1);
  });
});
