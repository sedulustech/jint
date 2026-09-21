// fixture: measured file
export const SMALL_LIMIT = 10;

export function clampToLimit(n: number): number {
  return Math.min(n, SMALL_LIMIT);
}
