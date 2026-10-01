import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
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
  // 1|0, not boolean: the router JSON-round-trips search values, so the wire
  // spelling report=1 parses to the NUMBER 1 in state - a boolean would
  // serialize to ?report=true and drift from the validator. The wire format
  // stays report=1|0 byte-clean end to end.
  report?: 1 | 0;
  rule?: string;
  input?: string;
  file?: string;
};

// the router's default search parser JSON.parses each value, so ?report=1
// arrives as the NUMBER 1 and ?rule=123 as the number 123 - coerce back to the
// string wire format or the validator would silently drop valid state
const asString = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

// Hand-rolled validator (no new validation dep): accept only known keys with
// known shapes; anything else degrades to absent, never throws.
export const validateRunSearch = (raw: Record<string, unknown>): RunSearch => {
  const report = asString(raw.report);
  return {
    ...(report === "1" || report === "0" ? { report: report === "1" ? 1 : 0 } : {}),
    ...(asString(raw.rule) !== undefined && { rule: asString(raw.rule) }),
    ...(asString(raw.input) !== undefined && { input: asString(raw.input) }),
    ...(asString(raw.file) !== undefined && { file: asString(raw.file) }),
  };
};

// Unknown/invalid params must not linger in the address bar: the URL is the
// state, so retaining ?report=2&bogus=1 after parse means the bar shows state
// the app dropped. Rewrites the address to the canonical validated form
// (replaceState: no history entry for a correction). Returns whether it fired.
export const canonicalizeSearch = (): boolean => {
  if (typeof window === "undefined" || !window.location) return false;
  const raw = new URLSearchParams(window.location.search);
  const clean = validateRunSearch(Object.fromEntries(raw));
  const kept = new Set(Object.keys(clean));
  const dirty = [...raw.keys()].some((k) => !kept.has(k));
  if (!dirty) return false;
  const qs = new URLSearchParams(
    Object.entries(clean).map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + (qs === "" ? "" : "?" + qs) + window.location.hash,
  );
  return true;
};

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

// ---- not-found -------------------------------------------------------------
// Unknown paths render INSIDE the app shell (same muted empty-state idiom the
// run view uses), never a bare "Not Found" without chrome.
const NotFound = () => (
  <div className="m-auto flex flex-col items-center gap-3 font-mono text-body text-muted-foreground">
    <p className="text-emphasis text-foreground">nothing here</p>
    <p>
      no route at this address - <Link to="/">back to the runs</Link>
    </p>
  </div>
);

// ---- routes ----------------------------------------------------------------
const RootComponent = () => {
  // parse-time cleanup runs once per boot; router-level search edits keep the
  // bar canonical afterwards because every writer goes through validateRunSearch
  useEffect(() => {
    canonicalizeSearch();
  }, []);
  return <Outlet />;
};

const rootRoute = createRootRoute({
  component: RootComponent,
  validateSearch: validateRunSearch,
  notFoundComponent: NotFound,
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

// splat catch-all: without a matching route the router renders nothing at all
// (no implicit 404), so unknown paths must land somewhere that renders NotFound
const catchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: NotFound,
});

const routeTree = rootRoute.addChildren([indexRoute, runRoute, catchRoute]);

// fresh router per boot: tests simulate full page loads by remounting against
// a new instance over the shared browser history
export const makeRouter = () => createRouter({ routeTree, defaultNotFoundComponent: NotFound });

export const router = makeRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
