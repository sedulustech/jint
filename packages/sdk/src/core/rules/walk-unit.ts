/**
 * The walk phase of one unit as a module of its own: it imports the grammar side only, so a walk
 * worker loads it without the classifier stack.
 */

import {
  decompose,
  languageOf,
  EMBEDDED,
  type GrammarRegistry,
  type Inventory,
  type InventoryElement,
} from "../grammars/walk.ts";
import type { Unit } from "../types.ts";

/** What a walk reads from the run: the grammar choice and the element size backstop. */
export interface WalkUnitOptions {
  /** Explicit grammar override; when absent the language comes from the state path's extension. */
  readonly language?: string;
  /** The run's registry value; absent = the embedded base. */
  readonly registry?: GrammarRegistry;
  /** The model's input window in tokens. Set: the fixed element backstop does not apply. */
  readonly maxInputTokens?: number;
}

/**
 * The walk phase, extracted: read + parse + extract the inventory (metadata + parent links), free
 * the tree. The lint pipeline walks every file unit ONCE up front and hands the result back, so
 * nothing ever re-walks.
 */
export interface WalkedUnit {
  readonly inventory: InventoryElement[];
  readonly derived?: Inventory;
  /** Why the unit could not be mapped to elements (file units only); streamed as an error. */
  readonly failed: string | null;
  readonly failedCause: unknown;
}

function missingGrammarReason(unit: Unit): string {
  // The message names the remedy: a file extension can gain a grammar mapping (sweep coverage);
  // a str unit has nothing to map, so the caller declares the language.
  return unit.kind === "file"
    ? "no grammar mapping for extension"
    : "cannot infer a grammar for piped stdin - declare it with --language";
}

export async function walkUnit(unit: Unit, options: WalkUnitOptions = {}): Promise<WalkedUnit> {
  if (unit.kind !== "file")
    return { inventory: [], failed: missingGrammarReason(unit), failedCause: undefined };
  const state = unit.state;
  const registry = options.registry ?? EMBEDDED;
  const language = options.language ?? languageOf(registry, state.path);
  if (language === null)
    return { inventory: [], failed: missingGrammarReason(unit), failedCause: undefined };
  // FileState.content is required and every unit constructor carries it — a typed read, no
  // union discriminator and no fallback to parse around.
  const source = state.content;
  try {
    const parsedSource = await decompose(source, language, {
      registry,
      backstop: options.maxInputTokens === undefined,
    });
    const inventory = [
      ...parsedSource.definitions,
      ...parsedSource.comments,
      ...parsedSource.imports,
    ];
    if (inventory.length === 0)
      return {
        inventory,
        failed:
          "no definitions, comments, or imports found — element-target rules cannot measure this file (per-rule exclude it if that is intentional)",
        failedCause: undefined,
      };
    return { inventory, derived: parsedSource, failed: null, failedCause: undefined };
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return { inventory: [], failed: `parse failed: ${detail}`, failedCause: thrown };
  }
}
