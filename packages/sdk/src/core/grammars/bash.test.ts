/**
 * The bash port: named functions, top-level settings, source lines, and the flow as a statement
 * group.
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const SCRIPT = `#!/usr/bin/env bash
# deploy helper
set -euo pipefail

source ./lib/common.sh
. "$HOME/.env"

readonly ROOT="$(pwd)"
export TARGET=prod
count=0

cleanup() { rm -rf "$tmp"; }
function build {
  local out="$1"
  make -C "$ROOT" "$out"
}

trap cleanup EXIT

case "\${1:-}" in
  build) build dist ;;
  *) echo usage >&2; exit 2 ;;
esac

if [ "$count" -gt 0 ]; then echo done; fi
build dist | tee log.txt
`;

describe("decompose — bash", () => {
  test("both function forms are named; top-level settings are bindings, a function's locals are not", async () => {
    const inv = await decompose(SCRIPT, "bash");
    expect(
      inv.definitions
        .filter((d) => d.capture !== "statement_group")
        .map((d) => [d.capture, d.name]),
    ).toEqual([
      ["binding", "ROOT"],
      ["binding", "TARGET"],
      ["binding", "count"],
      ["function", "cleanup"],
      ["function", "build"],
    ]);
  });

  test("source and dot lines are one merged import; the shebang and comments are comments", async () => {
    const inv = await decompose(SCRIPT, "bash");
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]!.content).toContain("./lib/common.sh");
    expect(inv.imports[0]!.content).toContain("$HOME/.env");
    expect(inv.comments.map((c) => c.content)).toEqual(["#!/usr/bin/env bash", "# deploy helper"]);
  });

  test("the flow at file scope is statement groups: the set line, then one run from trap to the pipe", async () => {
    const inv = await decompose(SCRIPT, "bash");
    const groups = inv.definitions.filter((d) => d.capture === "statement_group");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.content).toBe("set -euo pipefail");
    expect(groups[1]!.content.startsWith("trap cleanup EXIT")).toBe(true);
    expect(groups[1]!.content.endsWith("build dist | tee log.txt")).toBe(true);
  });

  test("a script with no definitions still yields its flow", async () => {
    const inv = await decompose("echo one\necho two\n", "bash");
    expect(inv.definitions.map((d) => d.capture)).toEqual(["statement_group"]);
  });
});
