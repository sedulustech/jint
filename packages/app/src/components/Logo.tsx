/**
 * The jint mark for the ui. Inlined with currentColor so it inherits the page color and follows the
 * manual light/dark toggle (an <img> cannot inherit CSS color, and a prefers-color-scheme media
 * query inside the svg would ignore a manual toggle). Geometry mirrors root logo.svg - the
 * README/favicon tile (public/logo.svg, fixed black background) is the bg-carrying variant.
 */
import type { JSX } from "react";

export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="36.5 -3.5 167 167"
      role="img"
      aria-label="jint"
      className={className}
    >
      <g fill="none" stroke="currentColor" strokeLinecap="butt" strokeLinejoin="miter">
        <path strokeWidth={7} d="M71 45H62V115H71" />
        <path strokeWidth={5.5} d="M81.125 55H73.125V105H81.125" />
        <path strokeWidth={4} d="M91 65H84V95H91" />
      </g>
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        transform="translate(240 0) scale(-1 1)"
      >
        <path strokeWidth={7} d="M71 45H62V115H71" />
        <path strokeWidth={5.5} d="M81.125 55H73.125V105H81.125" />
        <path strokeWidth={4} d="M91 65H84V95H91" />
      </g>
      <rect x={101.875} y={43.75} width={36.25} height={72.5} fill="currentColor" />
    </svg>
  );
}
