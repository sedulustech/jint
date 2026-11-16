import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DOC_FILES } from "../../../packages/sdk/src/docs.ts";
import { INSTALL_COMMAND, INSTALL_PROMPT } from "./install-prompt.ts";

describe("the install prompt", () => {
  it("installs with the command docs/install.md shows", () => {
    const install = readFileSync(new URL("../../../docs/install.md", import.meta.url), "utf8");
    expect(install).toContain(INSTALL_COMMAND);
  });

  it("names only docs that jint docs ships", () => {
    const named = [...INSTALL_PROMPT.matchAll(/`jint docs ([a-z/-]+)`/g)].map((m) => m[1] ?? "");
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(Object.keys(DOC_FILES)).toContain(name);
  });
});
