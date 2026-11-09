import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import sidebar from "../../sidebar.json";
import { groupBySidebar } from "./sidebar";

const docs = [{ id: "b" }, { id: "a" }, { id: "c" }];

describe("groupBySidebar", () => {
  test("the list is the grouping and the order, whatever order the docs arrive in", () => {
    const groups = groupBySidebar(docs, [
      { label: "One", items: ["c", "a"] },
      { label: "Two", items: ["b"] },
    ]);
    expect(groups.map((g) => [g.label, g.docs.map((d) => d.id)])).toEqual([
      ["One", ["c", "a"]],
      ["Two", ["b"]],
    ]);
  });

  test("a listed id with no doc fails, naming it", () => {
    expect(() => groupBySidebar(docs, [{ label: "G", items: ["a", "b", "c", "gone"] }])).toThrow(
      '"gone"',
    );
  });

  test("an id listed twice, across groups too, fails, naming it", () => {
    expect(() =>
      groupBySidebar(docs, [
        { label: "G", items: ["a", "b"] },
        { label: "H", items: ["a", "c"] },
      ]),
    ).toThrow('"a" twice');
  });

  test("a doc the list forgets fails, naming it", () => {
    expect(() => groupBySidebar(docs, [{ label: "G", items: ["a", "b"] }])).toThrow(
      "does not list: c",
    );
  });

  test("an empty group fails, naming it", () => {
    expect(() =>
      groupBySidebar(docs, [
        { label: "G", items: ["a", "b", "c"] },
        { label: "Empty", items: [] },
      ]),
    ).toThrow('"Empty" is empty');
  });
});

describe("web/sidebar.json against docs/", () => {
  // the docs the site renders: the same two patterns as content.config.ts
  const DOCS = new URL("../../../docs/", import.meta.url).pathname;
  const onSite = (relative: string) =>
    relative.endsWith(".md") &&
    (!relative.includes("/") ||
      relative.startsWith("use-cases/") ||
      relative.startsWith("reference/"));
  const ids = readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter(onSite)
    .map((relative) => relative.slice(0, -".md".length))
    .sort();

  test("every doc the site renders is in a group, and every listed id is a doc", () => {
    const listed = sidebar.flatMap((group) => group.items).sort();
    expect(listed).toEqual(ids);
  });
});
