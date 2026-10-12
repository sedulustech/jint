/**
 * The jint mark. The root logo.svg is canonical - the app serves a plain copy at public/logo.svg
 * (kept in sync; no symlink) and this renders it by URL, so the mark cannot drift per-surface.
 * Fixed black background + white strokes: reads on light and dark themes alike.
 */
import type { JSX } from "react";

export function Logo({ className }: { className?: string }): JSX.Element {
  return <img src="/logo.svg" alt="jint" className={className} />;
}
