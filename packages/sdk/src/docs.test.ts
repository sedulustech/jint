import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DOC_FILES, listDocs, readDoc } from "./docs.ts";

const docsDir = new URL("../../../docs/", import.meta.url).pathname;

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "designs" ? [] : pagesUnder(path);
    return path.endsWith(".md") ? [relative(docsDir, path).slice(0, -".md".length)] : [];
  });
}

test("every page the site shows ships with jint, and nothing else does", () => {
  expect(Object.keys(DOC_FILES).sort()).toEqual(pagesUnder(docsDir).sort());
});

test("a doc is read without its front matter, by name or with .md", () => {
  const body = readDoc("config")!;
  expect(body.startsWith("# ")).toBe(true);
  expect(readDoc("config.md")).toBe(body);
  expect(readDoc("reference/cli")).toContain("## Verbs");
});

test("a name that is not a doc reads as null", () => {
  expect(readDoc("nope")).toBeNull();
});

test("every doc is listed with a description", () => {
  const docs = listDocs();
  expect(docs.length).toBe(Object.keys(DOC_FILES).length);
  for (const doc of docs) expect(doc.description.length, doc.name).toBeGreaterThan(0);
});
