/**
 * Shared row affordance contract: every clickable table row (report panel, request log, grouped
 * tree) reads its cursor + hover from here, so all tables pick up the same affordance by
 * construction — one definition, no per-table class literals.
 */
export const ROW_CURSOR = "cursor-pointer";
export const ROW_HOVER = "hover:bg-muted";
