import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/", label: "runs" },
  { to: "/rules", label: "rules" },
] as const;

/** The page switch in the header: the runs of the store, or the rules of the repo. */
export function Nav() {
  return (
    <nav aria-label="pages" className="flex shrink-0 items-center gap-related">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          data-testid={`nav-${tab.label}`}
          activeOptions={{ exact: tab.to === "/" }}
          className="rounded-md px-chip-x py-chip-y text-body text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
