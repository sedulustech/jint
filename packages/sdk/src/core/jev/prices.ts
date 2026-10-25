/**
 * Input prices per million tokens, for the run UI's cost line. Only input is priced: a decision
 * model answers each question in about one output token. A model missing here has no cost line.
 */
const PRICES: { match: (model: string) => boolean; input: number; cachedInput?: number }[] = [
  { match: (m) => m.startsWith("jev-"), input: 0.045 },
  { match: (m) => m === "gpt-6-luna", input: 0.1, cachedInput: 0.01 },
];

/** A run's input cost in USD; cached tokens bill at the cached rate where the model has one. */
export function runCost(
  model: string | undefined,
  usage: { input: number; cached?: number } | undefined,
): number | undefined {
  const price = model === undefined ? undefined : PRICES.find((p) => p.match(model));
  if (price === undefined || usage === undefined) return undefined;
  const cached = usage.cached ?? 0;
  return ((usage.input - cached) * price.input + cached * (price.cachedInput ?? price.input)) / 1e6;
}
