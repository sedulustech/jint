/* Orphan: a blank line separates this from the declaration below, so it must stay standalone. */

export const later = 2;

// Orphan: the next thing is not a definition, so this can never attach.
import { readFileSync } from "node:fs";

export const referenced = typeof readFileSync;
