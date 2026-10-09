import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkDir, parseGitignore, compilePattern } from "./dir.ts";

async function collect(root: string, exclude?: readonly string[]): Promise<string[]> {
  const paths: string[] = [];
  for await (const unit of walkDir(root, exclude)) paths.push(unit.state.path);
  return paths;
}

describe("walkDir", () => {
  test("ancestor .gitignore files apply to a walk rooted deeper inside the tree", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "jint-walk-"));
    try {
      await mkdir(join(tmpRoot, ".git"), { recursive: true });
      await Bun.write(join(tmpRoot, ".gitignore"), "dist\ntmp/\n");
      const app = join(tmpRoot, "packages", "app");
      await mkdir(join(app, "dist"), { recursive: true });
      await mkdir(join(app, "tmp"), { recursive: true });
      await Bun.write(join(app, "dist", "bundle.js"), "export {};\n");
      await Bun.write(join(app, "tmp", "report.json"), "{}\n");
      await Bun.write(join(app, "keep.ts"), "export const keep = 1;\n");
      const paths = await collect(app);
      expect(paths).toEqual(["keep.ts"]);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
  test("excludes node_modules, .git, gitignored paths, and binaries by default", async () => {
    const paths = await collect("tests/fixtures/sample-dir");
    expect(paths).toContain("good.ts");
    expect(paths).toContain("sub/more.ts");
    expect(paths).not.toContain("ignored.ts"); // .gitignore
    expect(paths).not.toContain("node_modules/dep.js"); // default skip
    expect(paths).not.toContain("blob.bin"); // null-byte sniff
    expect(paths).not.toContain("photo.png"); // extension
  });

  test("non-source files yield raw units: measured or covered by lint, never dropped here", async () => {
    const paths = await collect("tests/fixtures/sample-dir");
    expect(paths).toContain("data.json"); // unmapped extension: a unit, lint decides its fate
    expect(paths).toContain("README.md"); // unmapped extension
    expect(paths).toContain("Makefile"); // extensionless
    expect(paths).toContain("good.ts"); // sources unaffected
  });
  test("file units carry { path, content, id } with paths relative to the root", async () => {
    for await (const unit of walkDir("tests/fixtures/sample-dir")) {
      expect(Object.keys(unit.state).sort()).toEqual(["content", "id", "path"]);
      expect(unit.state.path.startsWith("tests/fixtures")).toBe(false);
    }
  });

  test("config exclude patterns prune on top of defaults", async () => {
    const paths = await collect("tests/fixtures/sample-dir", ["**/more.ts"]);
    expect(paths).toEqual(["Makefile", "README.md", "data.json", "good.ts"]);
  });

  test("missing directory -> ENTRYPOINT_NOT_FOUND", async () => {
    expect(collect("no/such/dir")).rejects.toThrow(/directory not found/);
  });

  test("a file passed as a directory -> ENTRYPOINT_NOT_FOUND", async () => {
    expect(collect("tests/fixtures/sample-file.ts")).rejects.toThrow(/not a directory/);
  });
});

describe("parseGitignore", () => {
  test("comments, blank lines, and negation", () => {
    const rules = parseGitignore("# comment\n\nbuild/\n!build/keep.ts\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]!.dirOnly).toBe(true);
    expect(rules[1]!.negated).toBe(true);
  });
});

describe("compilePattern", () => {
  test("bare pattern matches at any depth", () => {
    const rule = compilePattern("node_modules");
    expect(rule.re.test("a/b/node_modules")).toBe(true);
    expect(rule.re.test("node_modules/x")).toBe(false);
  });

  test("glob patterns respect * vs **", () => {
    expect(compilePattern("**/more.ts").re.test("a/b/more.ts")).toBe(true);
    expect(compilePattern("*.ts").re.test("a/b/x.ts")).toBe(true);
    expect(compilePattern("src/*.ts").re.test("src/a/x.ts")).toBe(false);
    expect(compilePattern("src/*.ts").re.test("src/x.ts")).toBe(true);
  });
});
