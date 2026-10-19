/**
 * TIER 1 - THE SHARED CAPTURE CONTRACT. The cross-grammar lingua franca: the eight capture names
 * every grammar may address, their typed element shapes (the contract's Element union), and the
 * DEFAULTS that carry the shared vocabulary's meaning. This file is the ONLY engine source allowed
 * to hold capture-keyed behavior (the structural guard test enforces that - see
 * grammars.guard.test.ts): everything else is a #set! directive in the owning grammar's .scm.
 *
 * Promoting a word INTO this tier is a ceremony (a cross-grammar promise, documented in
 * docs/byog.md); a grammar-autonomous capture needs NO registration here - its .scm declares its
 * facts with capture.<name>.<knob> directives and the engine resolves them at walk time.
 */

/** The shared element captures: the closed lingua franca every grammar may address. */
export const SHARED_ELEMENT_CAPTURES = [
  "function",
  "method",
  "class",
  "type",
  "binding",
  "comment",
  "import",
  "docstring",
] as const;

export type SharedCapture = (typeof SHARED_ELEMENT_CAPTURES)[number];

export const isSharedCapture = (capture: string): capture is SharedCapture =>
  (SHARED_ELEMENT_CAPTURES as readonly string[]).includes(capture);

/** Lane captures: internal runs, never contained elements - exempt from suppression. */
export const SHARED_LANES: ReadonlySet<string> = new Set(["comment", "import", "docstring"]);

/**
 * DEFAULT definition-ness (is a capture's candidate an ELEMENT, or an internal lane?): the shared
 * definitions are function/method/class/type/binding; the lanes are not elements. A grammar
 * OVERRIDES either with `(#set! "capture.<name>.definition" "true"|"false")`. Autonomous captures
 * have NO default - their .scm must declare, or the capture is inert (and the load gate says so
 * loudly).
 */
const SHARED_DEFINITION_DEFAULTS: Readonly<Record<SharedCapture, boolean>> = {
  function: true,
  method: true,
  class: true,
  type: true,
  binding: true,
  comment: false,
  import: false,
  docstring: false,
};

export function sharedDefinitionDefault(capture: string): boolean {
  if (!isSharedCapture(capture)) return false;
  return SHARED_DEFINITION_DEFAULTS[capture];
}

/** One capture's suppression shape, resolved per grammar (see query.ts's suppression pass). */
export interface SuppressionShape {
  readonly absorbTail: number;
  readonly opaque: boolean;
}

/**
 * DEFAULT suppression shapes for the shared definition captures (the lingua franca's shape -
 * tier-1): absorbTail is the largest same-capture wrapper tail in BYTES that still reads as
 * prefix-absorb; opaque hides a different-capture candidate strictly inside. A grammar OVERRIDES
 * with `capture.<name>.absorbTail` / `capture.<name>.opaque` in its .scm. The cpp field/prototype
 * and verilog-trial nested-always questions settled these values as DATA; they live here as the
 * shared promise, not as per-grammar branches.
 */
export const SHARED_POLICY_DEFAULTS: Readonly<Record<string, SuppressionShape>> = {
  function: { absorbTail: 0, opaque: true },
  // method: function's shape (a nested method with a real body surfaces as a child)
  method: { absorbTail: 0, opaque: true },
  // class: type's shape (show-through interior - its methods surface as elements)
  class: { absorbTail: 2, opaque: false },
  type: { absorbTail: 2, opaque: false },
  binding: { absorbTail: 2, opaque: true },
};

/** An autonomous capture's conservative default (undeclared): hide nothing, absorb nothing. */
export const AUTONOMOUS_POLICY_DEFAULT: SuppressionShape = { absorbTail: 0, opaque: false };

export function sharedPolicyDefault(capture: string): SuppressionShape {
  return SHARED_POLICY_DEFAULTS[capture] ?? AUTONOMOUS_POLICY_DEFAULT;
}
