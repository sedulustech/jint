/**
 * The jint mark, inline (currentColor): inherits the surrounding text color so the same svg works
 * in the light and dark themes, and in the header it matches the h1 it replaces. The root logo.svg
 * is the canonical copy (README); this inlines the same strokes rather than fetching.
 */
import type { JSX } from "react";

export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="16 22 168 116"
      role="img"
      aria-label="jint"
      className={className}
    >
      <g fill="none" stroke="currentColor" strokeLinecap="butt" strokeLinejoin="miter">
        <path strokeWidth={7} d="M34 30H24V130H34" />
        <path strokeWidth={5.5} d="M52 42H44V118H52" />
        <path strokeWidth={4} d="M70 54H64V106H70" />
        <path strokeWidth={7} d="M166 30H176V130H166" />
        <path strokeWidth={5.5} d="M148 42H156V118H148" />
        <path strokeWidth={4} d="M130 54H136V106H130" />
      </g>
      <rect x={91} y={26.5} width={18} height={107} fill="currentColor" />
    </svg>
  );
}
