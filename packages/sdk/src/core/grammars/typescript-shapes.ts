// File header: the first comment run documents the module, never the import below it.
// A second header line joins the same run.

import { a } from "./a";
import b from "./b";
import * as c from "./c";
import type { T } from "./t";

import fs = require("fs");
import Alias = NS.Inner;
export * from "./barrel";
export { x } from "./x";
export { local };

/** JSDoc directly above a definition documents it. */
export function add(a: number, b: number): number {
  return a + b; // trailing comment inside a body
}
function plain() {}
async function fetchIt() {
  await 1;
  // a lone comment inside a body
}
function* gen() {
  yield 1;
}
export function* exportedGen() {}
export async function exportedAsync() {}
function overloaded(a: string): void;
function overloaded(a: number): void;
function overloaded(a: any): void {}
declare function ambient(): void;
function outer() {
  function inner() {}
  const innerArrow = () => 1;
  class InnerClass {}
  return inner;
}

const arrow = (x: number) => x * 2;
const fnExpr = function (x: number) { return x; };
let asyncArrow = async () => {};
var oldStyle = function named() {};
var oldArrow = () => 1;
export const exportedArrow = () => 1;
export var exportedFnExpr = function () {};
export const exportedConst = 42;
export var exportedVar = 1;
const one = 1, two = 2;
const { destructured } = obj;
const callResult = compute(); // trailing comment after a binding
const withMethods = { m() {}, k: () => 1 };
const ClassExpr = class {};

class Plain {}
export class Exported {}
abstract class Abs {
  abstract m(): void;
}
export abstract class ExportedAbs {}
class WithMembers extends Base implements I {
  field = 1;
  fieldArrow = () => {};
  constructor(x: number) {
    super();
  }
  method() {}
  static sm() {}
  async am() {}
  *gm() {}
  get g() { return 1; }
  set g(v: number) {}
  private priv() {}
  #hash() {}
  [Symbol.iterator]() {}
  "quoted"() {}
  overload(a: string): void;
  overload(a: number): void;
  overload(a: any): void {}
  /** Doc on a method. */
  documented() {
    function nested() {}
  }
}

interface I { m(): void; }
export interface EI {}
type Alias2 = string;
export type EAlias = number;
enum E { A }
export enum EE { A }
const enum CE { A }
declare enum DE { A }
declare const dc: number;
namespace NS {
  export function inNs() {}
}

/* A block comment above a describe. */
describe("suite", () => {
  it("case", () => {
    const helper = () => 1;
  });
  test.skip("skipped", () => {});
  beforeEach(() => {});
  describe("nested suite", function () {
    test("deep", () => {});
  });
});
test("title", () => {});
it.only("only", async () => {});
test(`template ${1}`, () => {});
test("no callback");
test.each([1, 2])("each %i", (n) => {});
describe.each([1])("suite each %i", (n) => {});
const test2 = test.concurrent;

"use strict";
setup();
run(); // trailing comment after a statement
// a comment between statements rides inside the group
if (ready) {
  go();
} else {
  stop();
}

for (const q of qs) {
  use(q);
}
while (more()) next();
do { again(); } while (cond());
switch (mode) { case 1: break; }
try { risky(); } catch (e) { recover(); }
throw new Error("top level");
label: for (;;) { break label; }
{ const scoped = 1; }

// loose: a blank row separates this comment from the definition below

function afterGroup() {}

export default function () {}

// two
// consecutive
// comments: one element

// a run split by a blank line
// is a second element
export default class {}
