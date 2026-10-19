/** The content echo for element-scoped queries - stderr only; stdout stays finding data. */
import { fileUnit } from "../input/file.ts";
import { elementWireId, selectElement, selectElements } from "../rules/classify.ts";
import type { InventoryElement } from "../grammars/walk.ts";
import type { Finding, Span, Unit } from "../types.ts";

const NL = String.fromCharCode(10);

export interface EchoSelection {
  readonly path: string;
  readonly anchor?: number;
  readonly ranges?: readonly { readonly start: number; readonly end: number }[];
}
/** The verdicts an element received: rule: level score; [] when none. */
function verdicts(findings: readonly Finding[], span: Span): string[] {
  return findings
    .filter(
      (f) =>
        f.location !== undefined &&
        f.location.span.start.line === span.start.line &&
        f.location.span.end.line === span.end.line,
    )
    .map((f) => f.rule + ": " + f.severity + " " + f.value.toFixed(2));
}

/** Edge lines: first and last, line-numbered left-aligned; a collapsed marker between. */
function edges(content: string, startLine: number): string {
  const lines = content.split(NL);
  const numbered = (line: string, no: number): string => String(no) + "  " + line;
  if (lines.length === 1) return numbered(lines[0]!, startLine);
  if (lines.length === 2)
    return [numbered(lines[0]!, startLine), numbered(lines[1]!, startLine + 1)].join(NL);
  return [
    numbered(lines[0]!, startLine),
    "  ... " + (lines.length - 2) + " more lines ...",
    numbered(lines[lines.length - 1]!, startLine + lines.length - 1),
  ].join(NL);
}

/** The rendered echo: the emitter lines (selection summaries) plus the unprefixed source block. */
export interface EchoRender {
  /**
   * One line per selected item, UNPREFIXED: "@L2-L4 -> 1 element: L2-L4". The consumer's emitter
   * owns the tool prefix - render these through it.
   */
  readonly headers: readonly string[];
  /**
   * Blank separator, verdict header and numbered source edges per picked element, UNPREFIXED. Empty
   * when the selection resolved nothing (that case already failed ELEMENT_NOT_FOUND).
   */
  readonly body: string;
}

/** One resolved element of an element-scoped selection, wire-shaped: what the run judged. */
export interface SelectedElement {
  /** The wire id (L38, L58-L59) findings and selectors paste back. */
  readonly id: string;
  readonly path: string;
  /** The jint capture the element is (definition, comment, ...). */
  readonly kind: string;
  /** The declared name, when the grammar bound one (render-only; definitions carry it). */
  readonly name?: string;
  readonly spanStart: number;
  readonly spanEnd: number;
  /** The captured text, exact: the content the rules measured. */
  readonly content: string;
}

/** The walk once, then anchor + range resolution: the picked elements per selector label. */
function pickElements(
  selection: EchoSelection,
  inventory: readonly InventoryElement[],
): { label: string; elements: InventoryElement[] }[] {
  const items: { label: string; elements: InventoryElement[] }[] = [];
  if (selection.anchor !== undefined) {
    const element = selectElement(inventory, { line: selection.anchor });
    items.push({ label: "@" + selection.anchor, elements: element === undefined ? [] : [element] });
  }
  for (const range of selection.ranges ?? []) {
    items.push({
      label: "@L" + range.start + "-L" + range.end,
      elements: selectElements(inventory, range),
    });
  }
  return items;
}

/**
 * The wire-shaped selection: one walk of the file, every element the selector picks, in selector
 * order. The run's consumer prints WHICH element was captured before trusting any score against it
 * - the SDK exposes the fact, the client owns the rendering.
 */
export async function selectedElements(selection: EchoSelection): Promise<SelectedElement[]> {
  const unit: Unit = await fileUnit(selection.path);
  const { walkUnit } = await import("../rules/classify.ts");
  const inventory: InventoryElement[] = (await walkUnit(unit)).inventory;
  if (inventory.length === 0) return [];
  const picked: InventoryElement[] = pickElements(selection, inventory).flatMap((i) => i.elements);
  return picked.map((e) => ({
    id: elementWireId(e.span),
    path: selection.path,
    kind: e.capture,
    name: e.name,
    spanStart: e.span.start.line,
    spanEnd: e.span.end.line,
    content: e.content,
  }));
}

/**
 * The full echo block. One walk of the selected file; spans render as wire ids (L38, L58-L59), the
 * notation findings and selectors use.
 */
export async function selectionEcho(
  selection: EchoSelection,
  findings: readonly Finding[],
): Promise<EchoRender> {
  const unit: Unit = await fileUnit(selection.path);
  const { walkUnit } = await import("../rules/classify.ts");
  const inventory: InventoryElement[] = (await walkUnit(unit)).inventory;
  if (inventory.length === 0) return { headers: [], body: "" };
  const items = pickElements(selection, inventory).map((item) => ({
    label: item.label,
    elements: item.elements,
    spans: item.elements.map((e) => elementWireId(e.span)),
  }));
  const headers = items.map((item) => {
    const noun = item.spans.length === 1 ? "element" : "elements";
    return item.label + " -> " + item.spans.length + " " + noun + ": " + item.spans.join(", ");
  });
  const picked = new Map<string, InventoryElement>();
  for (const item of items)
    for (const element of item.elements) picked.set(elementWireId(element.span), element);
  const blocks: string[] = [];
  for (const [id, element] of picked) {
    const v = verdicts(findings, element.span);
    const verdict = v.length > 0 ? " - " + v.join(", ") : "";
    const lineCount = element.span.end.line - element.span.start.line + 1;
    const unitLine = lineCount === 1 ? "1 line" : lineCount + " lines";
    blocks.push(
      NL +
        "--- " +
        selection.path +
        "@" +
        id +
        " (" +
        unitLine +
        ")" +
        verdict +
        " ---" +
        NL +
        edges(element.content, element.span.start.line),
    );
  }
  return { headers, body: blocks.length > 0 ? blocks.join(NL) + NL : "" };
}
