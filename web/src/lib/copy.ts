/** The copy controls' shared behavior: the code blocks' buttons and the install-prompt buttons. */

export const COPY_ICON =
  "M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184";
export const DONE_ICON = "m4.5 12.75 6 6 9-13.5";

/** How long a button shows its copied state. */
const CONFIRM_MS = 1500;

/** An icon element for a script-built button. */
export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const d = document.createElementNS("http://www.w3.org/2000/svg", "path");
  d.setAttribute("d", path);
  svg.append(d);
  return svg;
}

/**
 * On click, copy text() to the clipboard and show(true) for a moment, then show(false). Without
 * clipboard access (older app views, an insecure origin) the write fails, and onFail gets the error
 * to offer the reader another way to copy.
 */
export function copyOnClick(
  button: HTMLButtonElement,
  text: () => string,
  show: (copied: boolean) => void,
  onFail: (error: unknown) => void,
): void {
  let reset: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
    } catch (error) {
      onFail(error);
      return;
    }
    show(true);
    clearTimeout(reset);
    reset = setTimeout(() => show(false), CONFIRM_MS);
  });
}
