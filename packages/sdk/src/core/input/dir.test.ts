import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkDir, parseGitignore, compilePattern } from "./dir.ts";
import { resolveInput } from "./infer.ts";
import { inputStats } from "./stats.ts";

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

  test("the input accounting: every door counts, first-match attribution per glob", async () => {
    // include only .ts, one exclude glob: good.ts included; more.ts excluded BY GLOB (the exclude
    // door fires before include); the other five files fall outside include (include precedes
    // gitignore/binary: NOT_IN_INCLUDE owns them)
    const stats = inputStats();
    for await (const _unit of walkDir(
      "tests/fixtures/sample-dir",
      ["**/more.ts"],
      undefined,
      ["**/*.ts"],
      undefined,
      undefined,
      stats,
    )) {
      // drain
    }
    expect(stats.summary()).toEqual({
      discovered: 7,
      included: 1,
      excluded: [{ glob: "**/more.ts", count: 1 }],
      skipped: [{ reason: "NOT_IN_INCLUDE", count: 5 }],
    });
  });

  test("first-match attribution: a file counts against the FIRST glob that drops it", async () => {
    const stats = inputStats();
    for await (const _unit of walkDir(
      "tests/fixtures/sample-dir",
      ["**/*.ts", "**/more.ts"],
      undefined,
      undefined,
      undefined,
      undefined,
      stats,
    )) {
      // drain
    }
    // both .ts files match the FIRST glob; the second owns nothing and is omitted
    expect(stats.summary().excluded).toEqual([{ glob: "**/*.ts", count: 2 }]);
    // the remaining doors: two binaries (blob.bin sniff, photo.png extension) own their reason
    expect(stats.summary().skipped).toEqual([{ reason: "BINARY", count: 2 }]);
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

// ---------------------------------------------------------------------------
// The SECRET-SHAPED DENYLIST (owner decision after the leak audit): .env, id_rsa, *.pem, .npmrc
// et al reached the classifier whenever they were not gitignored. The matrix below is the audit's
// repro corpus, regressed at the walker level.
// ---------------------------------------------------------------------------

describe("secret-shaped denylist (directory walk)", () => {
  async function collectNotes(root: string, secretDenylist?: readonly string[]) {
    const paths: string[] = [];
    const notes: string[] = [];
    for await (const unit of walkDir(root, undefined, undefined, undefined, secretDenylist, (n) =>
      notes.push(n),
    )) {
      paths.push(unit.state.path);
    }
    return { paths, notes };
  }

  test("the audit corpus yields no units from a directory walk; one coverage note per class", async () => {
    const root = await mkdtemp(join(tmpdir(), "jint-secrets-"));
    try {
      // no .gitignore at all: the denylist must carry the whole weight (the audit's finding)
      for (const name of [".env", "db.env", "id_rsa", ".npmrc", "server.pem", "secrets.txt"]) {
        await Bun.write(join(root, name), "SECRET\n");
      }
      await Bun.write(join(root, "app.ts"), "export {};\n");
      const { paths, notes } = await collectNotes(root);
      expect(paths).toEqual(["app.ts"]);
      // ONE note per CLASS, never per path: six files, six distinct classes
      expect(notes).toHaveLength(6);
      expect(notes).toContain("secret denylist skipped 1 path(s) matching '.env'");
      expect(notes).toContain("secret denylist skipped 1 path(s) matching '*.env'");
      expect(notes).toContain("secret denylist skipped 1 path(s) matching 'id_*'");
      expect(notes).toContain("secret denylist skipped 1 path(s) matching '.npmrc'");
      expect(notes).toContain("secret denylist skipped 1 path(s) matching '*.pem'");
      expect(notes).toContain("secret denylist skipped 1 path(s) matching 'secrets*'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("!keep.pem negation re-admits the file - UNLESS its bytes are PEM armor (sniff backstop)", async () => {
    const root = await mkdtemp(join(tmpdir(), "jint-secrets-neg-"));
    try {
      await Bun.write(join(root, "keep.pem"), "not actually a key\n");
      await Bun.write(join(root, "key2.pem"), "-----BEGIN CERTIFICATE-----\nabc\n-----END-----\n");
      await Bun.write(join(root, "real.pem"), "-----BEGIN PRIVATE KEY-----\nabc\n-----END-----\n");
      const { paths, notes } = await collectNotes(root, ["*.pem", "!key2.pem"]);
      // keep.pem: denied by the pattern class outright; key2.pem: RE-ADMITTED by the deeper
      // negation but its bytes are PEM armor - the sniff backstop skips it anyway; real.pem:
      // denied by the pattern class. Nothing yields.
      expect(paths).toEqual([]);
      expect(notes).toContain("secret denylist skipped 2 path(s) matching '*.pem'");
      expect(notes).toContain(
        "secret denylist skipped 1 path(s) with a PEM header ('-----BEGIN ')",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the config override replaces the list: a repo linting .env.example keeps it", async () => {
    const root = await mkdtemp(join(tmpdir(), "jint-secrets-cfg-"));
    try {
      await Bun.write(join(root, ".env.example"), "HOST=\n");
      await Bun.write(join(root, ".env"), "SECRET\n");
      await Bun.write(join(root, "app.ts"), "export {};\n");
      // default list: .env.example is .env.*-shaped, skipped
      const denied = await collectNotes(root);
      expect(denied.paths).toEqual(["app.ts"]);
      // override: drop the .env.* class, keep the rest - .env.example measures
      const allowed = await collectNotes(root, [
        ".env",
        ".npmrc",
        ".envrc",
        "credentials",
        "id_*",
        "*.pem",
        "*.key",
        "secrets*",
        ".netrc",
        ".pgpass",
      ]);
      expect(allowed.paths.sort()).toEqual([".env.example", "app.ts"]);
      expect(allowed.notes).toContain("secret denylist skipped 1 path(s) matching '.env'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a secret-shaped DIRECTORY (id_rsa/) prunes the walk", async () => {
    const root = await mkdtemp(join(tmpdir(), "jint-secrets-dir-"));
    try {
      await mkdir(join(root, "id_rsa"), { recursive: true });
      await Bun.write(join(root, "id_rsa", "key.pem"), "-----BEGIN X-----\n");
      await Bun.write(join(root, "app.ts"), "export {};\n");
      const { paths } = await collectNotes(root);
      expect(paths).toEqual(["app.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an explicitly passed file bypasses the denylist entirely (explicit path = consent)", async () => {
    // resolveInput's file path never enters walkDir: the denylist is a DIRECTORY-walk mechanism.
    // Verified at the resolution seam: an explicit .env yields its unit.
    const root = await mkdtemp(join(tmpdir(), "jint-secrets-explicit-"));
    try {
      // credentials.ts: denylist-shaped NAME, but .ts so the explicit file path resolves a grammar
      const envPath = join(root, "credentials.ts");
      await Bun.write(envPath, "export const SECRET = 1;\n");
      const units: string[] = [];
      for await (const unit of resolveInput({ input: envPath, inputType: "file" })) {
        units.push("path" in unit.state ? unit.state.path : "");
      }
      expect(units).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
