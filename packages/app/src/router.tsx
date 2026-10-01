import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { App } from "./App";

// ---- URL state -------------------------------------------------------------
// The run selection lives in the path (/runs/$runId); the panel state lives in
// validated search params. Two panel surfaces exist in the run view and they
// COEXIST (a report panel and a rule-target detail pane can be open at once),
// so a single "panel" enum cannot represent the state space:
//   report=1|0        report panel; absent = follow the run default (open iff report.json exists)
//   rule/input/file   presence of rule opens PairDetail; file is optional
// Everything else (group-by mode, theme, focus) stays local state on purpose.

export type RunSearch = {
  report?: boolean;
  rule?: string;
  input?: string;
  file?: string;
};

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

// Hand-rolled validator (no new validation dep): accept only known keys with
// known shapes; anything else degrades to absent, never throws.
export const validateRunSearch = (raw: Record<string, unknown>): RunSearch => ({
  ...(raw.report === "1" || raw.report === "0" ? { report: raw.report === "1" } : {}),
  ...(asString(raw.rule) !== undefined && { rule: asString(raw.rule) }),
  ...(asString(raw.input) !== undefined && { input: asString(raw.input) }),
  ...(asString(raw.file) !== undefined && { file: asString(raw.file) }),
});

// ---- legacy hash links -----------------------------------------------------
// Old links are #/runs/<id> (and the older #runs/<id> spelling). History-mode
// paths replace them: rewrite to /runs/<id> before the router boots so old
// bookmarks keep working. Idempotent; only fires on the legacy shape.
export const redirectLegacyHash = () => {
  if (typeof window === "undefined" || !window.location) return;
  const m = window.location.hash.match(/^#\/?runs\/([^/\s]+)\/?$/);
  if (m === null) return;
  const search = window.location.search;
  window.history.replaceState(null, "", "/runs/" + m[1] + search);
};

// ---- routes ----------------------------------------------------------------
const RootComponent = () => (
  <>
    <Outlet />
  </>
);

const rootRoute = createRootRoute({
  component: RootComponent,
  validateSearch: validateRunSearch,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <App runId={null} />,
});

const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: () => {
    const { runId } = runRoute.useParams();
    return <App runId={runId} />;
  },
});

const routeTree = rootRoute.addChildren([indexRoute, runRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
