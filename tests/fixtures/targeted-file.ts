// A standalone comment with no code attached: narration about the module.
export function bareDefinition(epoch: number): number {
  return epoch;
}

// Explains why the cache exists: stale reads broke the offline mode.
export function documentedDefinition(ms: number): number {
  return ms;
}
