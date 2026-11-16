import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { figurePath } from "./figures.ts";

const DOCS = fileURLToPath(new URL("../../../docs/", import.meta.url));
const FIGURES = `${DOCS}figures/`;

function docs(dir = DOCS): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? docs(`${dir}${entry.name}/`)
      : entry.name.endsWith(".md")
        ? [`${dir}${entry.name}`]
        : [],
  );
}

describe("figurePath", () => {
  it("resolves a figure from a top-level doc and from a nested one", () => {
    expect(figurePath("figures/messages.svg")).toBe("figures/messages.svg");
    expect(figurePath("../figures/messages.svg", "guides")).toBe("figures/messages.svg");
  });

  it("leaves other images alone", () => {
    expect(figurePath("https://example.com/a.svg")).toBeNull();
    expect(figurePath("shot.png")).toBeNull();
  });
});

describe("docs/figures", () => {
  const files = readdirSync(FIGURES).filter((name) => name.endsWith(".svg"));
  const referenced = new Set(
    docs().flatMap((doc) => {
      const from = doc.slice(DOCS.length).split("/").slice(0, -1).join("/");
      return [...readFileSync(doc, "utf8").matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
        .map((m) => figurePath(m[1] ?? "", from))
        .filter((path) => path !== null);
    }),
  );

  it("every referenced figure exists and every figure is referenced", () => {
    expect([...referenced].sort()).toEqual(files.map((name) => `figures/${name}`).sort());
  });

  it("figures style with the site's CSS variables, never a class or a bare color", () => {
    for (const name of files) {
      const svg = readFileSync(`${FIGURES}${name}`, "utf8");
      expect(svg).not.toMatch(/\sclass="/);
      // a color appears only as the fallback inside var(--token, #fallback)
      expect(svg.replace(/var\(--[a-z-]+, [^)]+\)/g, "")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });
});
