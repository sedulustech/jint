import { mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * The shared tmp/ scratch space for CLI-process tests. tmp/ is gitignored and does not exist on a
 * fresh checkout, so EVERY file that writes into it must create it through this helper - relying on
 * a sibling file's mkdir was a CI flake (file-order dependency, ENOENT on a clean clone). Paths are
 * caller-named and unique-per-test by construction (pid + ms suffix where needed); cleanup is the
 * writer's job (rmScratchFile for one-off files, rmSync for trees).
 */

/** Idempotently ensure the shared scratch dir exists; returns its absolute path. */
export function scratchRoot(): string {
  const root = join(import.meta.dir, "..", "..", "tmp");
  mkdirSync(root, { recursive: true });
  return root;
}

/** A unique file path inside the scratch dir; the file itself is created by the caller. */
export function scratchFile(name: string): string {
  return join(scratchRoot(), `${name}-${process.pid}-${Date.now()}`);
}

/** A unique, freshly created directory inside the scratch dir. */
export function scratchDir(name: string): string {
  const dir = join(scratchRoot(), `${name}-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a scratch file when present; failures are ignored (best-effort cleanup). */
export function rmScratchFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone */
  }
}

/** Remove a scratch tree when present (force: the caller owns it). */
export function rmScratchTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
