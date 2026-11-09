import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_FILES, exportSkills } from "./skills.ts";

const root = new URL("../../../skills/", import.meta.url).pathname;

test("every embedded skill file is the repo's file", () => {
  expect(Object.keys(SKILL_FILES).sort()).toEqual([
    "jint-author/SKILL.md",
    "jint-follow/SKILL.md",
    "jint-propose/SKILL.md",
  ]);
  for (const [path, content] of Object.entries(SKILL_FILES)) {
    expect(content).toBe(readFileSync(join(root, path), "utf8"));
  }
});

test("exportSkills writes each skill under the directory and replaces an existing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "jint-skills-"));
  try {
    const target = join(dir, "nested", "skills");
    expect(exportSkills(target)).toEqual(Object.keys(SKILL_FILES));
    expect(readFileSync(join(target, "jint-follow/SKILL.md"), "utf8")).toBe(
      SKILL_FILES["jint-follow/SKILL.md"]!,
    );
    exportSkills(target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
