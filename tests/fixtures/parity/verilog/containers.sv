// The verilator-trial container proposal, landed as the @class/@type container slice.
// BEFORE (see the WAITING ledger in embedded/verilog/queries.scm and ../README.md): every shape
// in this file except the module extracted ZERO elements. AFTER: 4 containers + 2 typedefs as
// @type, 1 class as @class (7 new definition elements); the class task stays @function.
// Pinned by packages/sdk/src/core/input/class-method.test.ts (verilog case).
package pkg_a;
  parameter int W = 8;
endpackage

interface ifc_t (input logic clk);
  logic req;
endinterface

program prog_t;
  initial $display("hi");
endprogram

checker chk_t (input logic a);
endchecker

typedef enum {A, B} state_t;
typedef logic [7:0] byte_t;

class pkt_t;
  int size;
  task run();
    size++;
  endtask
endclass

module m;
  pkt_t p;
endmodule
