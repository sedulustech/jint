/**
 * Guards the shape of packages/rules: every directory beside src/ is one domain, one package named
 *
 * @jint/rules-<domain>, whose src/index.ts exports `rules` and each rule under its own name, and
 * the aggregate in src/ imports exactly the domains that exist. The checker is a plain function
 * over a directory, so the cases below can break a copy of the tree one way at a time and prove
 * each break is reported.
 */
import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RULES_DIR = join(import.meta.dir, "..");

const domainsOf = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "src" && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();

async function layoutProblems(root: string): Promise<string[]> {
  const problems: string[] = [];
  const domains = domainsOf(root);
  const aggregate = readFileSync(join(root, "src", "index.ts"), "utf8");
  const aggregatePackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== "package.json") {
      problems.push(
        `packages/rules/${entry.name}: a stray file; only domains, src and package.json belong here`,
      );
    }
  }
  for (const domain of domains) {
    const packagePath = join(root, domain, "package.json");
    if (!existsSync(packagePath)) {
      problems.push(`${domain}: no package.json`);
      continue;
    }
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: string;
      private?: boolean;
      exports?: Record<string, string>;
    };
    if (pkg.name !== `@jint/rules-${domain}`) {
      problems.push(`${domain}: package name is ${pkg.name}, expected @jint/rules-${domain}`);
    }
    if (pkg.private !== true) problems.push(`${domain}: package is not private`);
    if (pkg.exports?.["."] !== "./src/index.ts")
      problems.push(`${domain}: exports "." is not ./src/index.ts`);
    const entry = join(root, domain, "src", "index.ts");
    if (!existsSync(entry)) {
      problems.push(`${domain}: no src/index.ts`);
    } else {
      const mod = (await import(entry)) as Record<string, unknown>;
      const rules = mod.rules;
      if (!Array.isArray(rules)) {
        problems.push(`${domain}: src/index.ts does not export rules`);
      } else {
        for (const rule of rules as { name: string }[]) {
          if (mod[rule.name] !== rule) {
            problems.push(`${domain}: rule ${rule.name} is not exported under its own name`);
          }
        }
      }
    }
    if (!aggregate.includes(`from "@jint/rules-${domain}"`)) {
      problems.push(
        `${domain}: the aggregate (src/index.ts) does not import @jint/rules-${domain}`,
      );
    }
    if (aggregatePackage.dependencies?.[`@jint/rules-${domain}`] === undefined) {
      problems.push(
        `${domain}: the aggregate package.json does not depend on @jint/rules-${domain}`,
      );
    }
  }
  for (const m of aggregate.matchAll(/from "@jint\/rules-([\w-]+)"/g)) {
    if (!domains.includes(m[1]!)) {
      problems.push(
        `the aggregate imports @jint/rules-${m[1]} but packages/rules/${m[1]} does not exist`,
      );
    }
  }
  return problems;
}

/** A throwaway copy of the rules tree, broken by `mutate`, and the problems the checker reports. */
async function problemsAfter(mutate: (root: string) => void): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "jint-rules-layout-"));
  try {
    cpSync(RULES_DIR, root, { recursive: true, filter: (src) => !src.includes("node_modules") });
    mutate(root);
    return await layoutProblems(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const edit = (path: string, from: string | RegExp, to: string) =>
  writeFileSync(path, readFileSync(path, "utf8").replace(from, to));

describe("packages/rules layout", () => {
  test("the repo's tree has no problems", async () => {
    expect(await layoutProblems(RULES_DIR)).toEqual([]);
  });

  test("a package named for another domain is reported", async () => {
    const problems = await problemsAfter((r) =>
      edit(join(r, "errors", "package.json"), "@jint/rules-errors", "@jint/rules-error"),
    );
    expect(problems).toContain(
      "errors: package name is @jint/rules-error, expected @jint/rules-errors",
    );
  });

  test("a domain with no entry file is reported", async () => {
    const problems = await problemsAfter((r) => rmSync(join(r, "errors", "src", "index.ts")));
    expect(problems).toContain("errors: no src/index.ts");
  });

  test("a domain the aggregate does not import is reported", async () => {
    const problems = await problemsAfter((r) =>
      edit(join(r, "src", "index.ts"), /import \{ rules as errors \}[^\n]*\n/, ""),
    );
    expect(problems).toContain(
      "errors: the aggregate (src/index.ts) does not import @jint/rules-errors",
    );
  });

  test("a rule exported under another identifier is reported", async () => {
    const problems = await problemsAfter((r) => {
      const file = join(r, "naming", "src", "index.ts");
      edit(file, "export const is_greppable", "export const isGreppable");
      edit(file, /^ {2}is_greppable,$/m, "  isGreppable,");
    });
    expect(problems).toContain("naming: rule is_greppable is not exported under its own name");
  });

  test("a directory with no package is reported", async () => {
    const problems = await problemsAfter((r) => mkdirSync(join(r, "security")));
    expect(problems).toContain("security: no package.json");
  });

  test("a stray file beside the domains is reported", async () => {
    const problems = await problemsAfter((r) => writeFileSync(join(r, "notes.md"), "scratch\n"));
    expect(problems.some((p) => p.startsWith("packages/rules/notes.md: a stray file"))).toBe(true);
  });
});
