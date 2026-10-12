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
      viewBox="62 43.75 116 72.5"
      role="img"
      aria-label="jint"
      className={className}
    >
      <g fill="none" stroke="currentColor" strokeLinecap="butt" strokeLinejoin="miter">
        <path strokeWidth={2.5} d="M71 45H62V115H71" />
        <path strokeWidth={2} d="M81.125 55H73.125V105H81.125" />
        <path strokeWidth={1.5} d="M91 65H84V95H91" />
      </g>
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        transform="translate(240 0) scale(-1 1)"
      >
        <path strokeWidth={2.5} d="M71 45H62V115H71" />
        <path strokeWidth={2} d="M81.125 55H73.125V105H81.125" />
        <path strokeWidth={1.5} d="M91 65H84V95H91" />
      </g>
      <rect x={101.875} y={43.75} width={36.25} height={72.5} fill="currentColor" />
    </svg>
  );
}
