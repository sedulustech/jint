// A two-bit counter with a registered output.
module counter #(parameter WIDTH = 2) (
    input  wire clk,
    input  wire rst_n,
    output reg  [WIDTH-1:0] count
);

  wire enable;
  assign enable = 1'b1;

  // Counter advances on clk when enabled.
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= {WIDTH{1'b0}};
    end else if (enable) begin
      count <= count + 1'b1;
    end
  end
endmodule

// Top level wiring one counter instance.
module top;
  wire clk = 1'b0;
  wire rst_n = 1'b1;
  wire [1:0] value;

  counter #(.WIDTH(2)) u_counter (
      .clk(clk),
      .rst_n(rst_n),
      .count(value)
  );
endmodule
