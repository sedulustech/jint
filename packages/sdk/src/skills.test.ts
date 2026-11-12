import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_FILES, exportSkills } from "./skills.ts";

const root = new URL("../../../skills/", import.meta.url).pathname;

test("every embedded skill file is the repo's file", () => {
  expect(Object.keys(SKILL_FILES).sort()).toEqual([
    "following-rule-results/SKILL.md",
    "propose-rules/SKILL.md",
    "writing-captures/SKILL.md",
    "writing-rules/SKILL.md",
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
    expect(readFileSync(join(target, "following-rule-results/SKILL.md"), "utf8")).toBe(
      SKILL_FILES["following-rule-results/SKILL.md"]!,
    );
    exportSkills(target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every skill's front matter meets the documented limits", () => {
  for (const [path, content] of Object.entries(SKILL_FILES)) {
    const block = /^---\n([\s\S]*?)\n---\n/.exec(content);
    expect(block, `${path} has no front matter`).not.toBeNull();
    const { name, description } = Bun.YAML.parse(block![1]!) as Record<string, unknown>;
    expect(typeof name, `${path} name`).toBe("string");
    expect(name as string, `${path} name`).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(name as string, `${path} name`).not.toMatch(/anthropic|claude/);
    expect(name, `${path} name is its directory`).toBe(path.split("/")[0]);
    expect(typeof description, `${path} description`).toBe("string");
    expect((description as string).trim().length, `${path} description`).toBeGreaterThan(0);
    expect((description as string).length, `${path} description`).toBeLessThanOrEqual(1024);
    expect(`${name} ${description}`, `${path} has an XML tag`).not.toMatch(/<[^>]+>/);
  }
});
