// Single-consumer fixture for composite descent (walk.test.ts): nested describe/it plus a
// class whose methods become elements of their own. Not imported anywhere else.

// Minimal globals so the fixture typechecks without test-runner types.
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(actual: unknown): { toBe(expected: unknown): void };

describe("outer", () => {
  it("inner", () => {
    expect(1).toBe(1);
  });
});

class Widget {
  render(): string {
    return "widget";
  }
}
