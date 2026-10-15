export interface Config {
  readonly name: string;
}

/** Class docstring. */
export class Renderer implements Config {
  readonly name: string;

  constructor(name: string) {
    // inner comment
    this.name = name;
  }

  render(): string {
    return this.name;
  }
}

// Leading comment on the helper.
export function topLevel(count: number): string {
  const result = count;
  return String(result);
}

const handler = (): void => undefined;
const binding = 1;
let mutable = 2;

describe("renderer", () => {
  it("renders", () => {
    expect(true).toBe(true);
  });
});

import { readFile } from "node:fs/promises";
