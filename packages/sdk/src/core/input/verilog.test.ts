/**
 * The verilog port: modules are the type containers, always/initial constructs are functions (the
 * honest-stretch call, documented in queries.scm), nets are bindings, instantiations are WAITING
 * (the ledger's module/port/instance captures).
 */
import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const SRC = [
  "// Counter.",
  "module counter (input wire clk);",
  "  wire enable;",
  "  assign enable = 1'b1;",
  "  always @(posedge clk) begin",
  "    enable <= 1'b1;",
  "  end",
  "endmodule",
].join("\n");

describe("decompose — verilog", () => {
  test("modules capture named; always blocks and nets live inside", async () => {
    const inv = await decompose(SRC, "verilog");
    expect(inv.definitions.map((d) => [d.capture, d.name, d.nodeType, d.parent])).toEqual([
      ["type", "counter", "module_declaration", undefined],
      ["binding", undefined, "net_declaration", "d0"],
      ["binding", undefined, "continuous_assign", "d0"],
      ["function", undefined, "always_construct", "d0"],
    ]);
  });

  test("a leading comment attaches to its module", async () => {
    const inv = await decompose(SRC, "verilog");
    expect(inv.definitions[0]!.attachedComment).toEqual(["// Counter."]);
  });
});
