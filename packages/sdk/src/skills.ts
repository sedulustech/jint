/**
 * The agent skills that ship with jint: the repo's skills/ directory, embedded in the package (and
 * in the compiled binary) as text, so a user with only the CLI can write them to a skills directory
 * of their own.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import followingSkill from "../../../skills/following-rule-results/SKILL.md" with { type: "text" };
import proposeSkill from "../../../skills/propose-rules/SKILL.md" with { type: "text" };
import writingCapturesSkill from "../../../skills/writing-captures/SKILL.md" with { type: "text" };
import writingSkill from "../../../skills/writing-rules/SKILL.md" with { type: "text" };

/** Each embedded skill file: its path under a skills directory, and its content. */
export const SKILL_FILES: Readonly<Record<string, string>> = {
  "writing-rules/SKILL.md": writingSkill,
  "writing-captures/SKILL.md": writingCapturesSkill,
  "following-rule-results/SKILL.md": followingSkill,
  "propose-rules/SKILL.md": proposeSkill,
};

/**
 * Writes every skill under `dir` (one directory per skill, as an agent reads them), creating
 * directories and replacing files that exist. Returns the paths written, relative to `dir`.
 */
export function exportSkills(dir: string): string[] {
  const written: string[] = [];
  for (const [path, content] of Object.entries(SKILL_FILES)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(path);
  }
  return written;
}
