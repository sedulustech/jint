import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { App } from "./App";
import { RulesPage } from "./views/Rules";

// ---- URL state -------------------------------------------------------------
// The run selection lives in the path (/runs/$runId); the panel state lives in
// validated search params:
//   rule/input/file   presence of rule opens ClassificationDetail; file is optional
// The run errors list is a child route (/runs/$runId/errors), not a param: the
// run view keeps rendering underneath. On that route rule/input address the
// errors dialog instead of the pane (input holds / and #, so it stays a query
// value) and the pane stays closed.
// Everything else (group-by mode, theme, focus) stays local state on purpose.

export type RunSearch = {
  rule?: string;
  input?: string;
  file?: string;
};

// the router's default search parser JSON.parses each value, so ?rule=123
// arrives as the number 123 - coerce back to the
// string wire format or the validator would silently drop valid state
const asString = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

// Hand-rolled validator (no new validation dep): accept only known keys with
// known shapes; anything else degrades to absent, never throws.
export const validateRunSearch = (raw: Record<string, unknown>): RunSearch => {
  const rule = asString(raw.rule);
  const input = asString(raw.input);
  const file = asString(raw.file);
  // Statement build, NOT conditional spreads: absent must stay absent here - canonicalizeSearch
  // walks Object.keys(clean), so a present-undefined key would serialize as rule=undefined.
  const clean: RunSearch = {};
  if (rule !== undefined) clean.rule = rule;
  if (input !== undefined) clean.input = input;
  if (file !== undefined) clean.file = file;
  return clean;
};

// Unknown/invalid params must not linger in the address bar: the URL is the
// state, so retaining ?bogus=1 after parse means the bar shows state
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

// ---- not-found -------------------------------------------------------------
// Unknown paths render INSIDE the app shell (same muted empty-state idiom the
// run view uses), never a bare "Not Found" without chrome.
// Shared by the splat route (unknown address) and by App (known route shape,
// nonexistent run id): one 404 idiom everywhere.
export const NotFound = ({
  title = "nothing here",
  detail = "no route at this address",
}: {
  title?: string;
  detail?: string;
}) => (
  <div
    data-testid="not-found"
    className="m-auto flex flex-col items-center gap-sections text-body text-muted-foreground"
  >
    <p className="text-emphasis text-foreground">{title}</p>
    <p>
      {detail} - <Link to="/">back to the runs</Link>
    </p>
  </div>
);

// ---- routes ----------------------------------------------------------------
const RootComponent = () => {
  useEffect(function canonicalizeSearchOnBoot() {
    canonicalizeSearch();
  }, []);
  return <Outlet />;
};

const rootRoute = createRootRoute({
  component: RootComponent,
  validateSearch: validateRunSearch,
  notFoundComponent: () => <NotFound />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <App runId={null} />,
});

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rules",
  component: RulesPage,
});

const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: () => {
    const { runId } = runRoute.useParams();
    return <App runId={runId} />;
  },
});

// no component: the run view reads the match (useErrorsRoute) and opens the list
// under its header; search is validated by the root, same as the run route
const errorsRoute = createRoute({
  getParentRoute: () => runRoute,
  path: "errors",
});

// splat catch-all: without a matching route the router renders nothing at all
// (no implicit 404), so unknown paths must land somewhere that renders NotFound
const catchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: () => <NotFound />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  rulesRoute,
  runRoute.addChildren([errorsRoute]),
  catchRoute,
]);

// fresh router per boot: tests simulate full page loads by remounting against
// a new instance over the shared browser history
export const makeRouter = () =>
  createRouter({ routeTree, defaultNotFoundComponent: () => <NotFound /> });

export const router = makeRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
