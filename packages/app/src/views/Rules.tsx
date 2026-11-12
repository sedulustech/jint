import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { fetchRules } from "../api/client";
import { Nav } from "./Nav";
import { ThemeButtons } from "./ThemeButtons";
import { useTheme } from "./useTheme";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HandlerData } from "@jint/contract";
import type { RuleKind, RuleRun, RuleView } from "@jint/sdk/ui/rules";

type Filter = "all" | RuleKind | "never";
type Level = "pass" | "warn" | "error";
type Tier = Level | { level: Level; message?: string };

const FILTERS: readonly Filter[] = ["all", "noul", "choice", "score", "never"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "all",
  noul: "noul",
  choice: "choice",
  score: "score",
  never: "never ran",
};
const HISTORY = 14;
const BAR_WIDTH = 150;
const BAR_HEIGHT = 10;

const LEVEL_FILL: Record<Level, string> = {
  pass: "fill-sev-clean/30",
  warn: "fill-sev-warn/60",
  error: "fill-sev-error/60",
};
const LEVEL_TEXT: Record<Level, string> = {
  pass: "text-sev-clean",
  warn: "text-sev-warn",
  error: "text-sev-error",
};

const levelOf = (tier: Tier): Level => (typeof tier === "string" ? tier : tier.level);
const messageOfTier = (tier: Tier): string | undefined =>
  typeof tier === "string" ? undefined : tier.message;

/** The handle's tiers: one per score level or per choice option, in declared order. */
const tiersOf = (rule: RuleView): Tier[] => {
  const handle = rule.handle as Record<string, unknown> | null;
  if (handle === null) return [];
  if (rule.kind === "score") return (handle.map ?? []) as Tier[];
  return Object.values((handle.choices ?? {}) as Record<string, Tier>);
};

interface Zone {
  startsAt: number;
  endsAt: number;
  level: Level;
}

interface NoulThresholds {
  warn?: { greater_than?: number; less_than?: number };
  error?: { greater_than?: number; less_than?: number };
}

const zonesFiringBelow = (thresholds: NoulThresholds): Zone[] => {
  const warnBelow = thresholds.warn?.less_than;
  const errorBelow = thresholds.error?.less_than ?? 0;
  const passFrom = warnBelow ?? errorBelow;
  return [
    { startsAt: 0, endsAt: errorBelow, level: "error" },
    { startsAt: errorBelow, endsAt: passFrom, level: "warn" },
    { startsAt: passFrom, endsAt: 1, level: "pass" },
  ];
};

const zonesFiringAbove = (thresholds: NoulThresholds): Zone[] => {
  const warnAbove = thresholds.warn?.greater_than;
  const errorAbove = thresholds.error?.greater_than;
  const warnFrom = warnAbove ?? errorAbove ?? 1;
  return [
    { startsAt: 0, endsAt: warnFrom, level: "pass" },
    { startsAt: warnFrom, endsAt: errorAbove ?? 1, level: "warn" },
    { startsAt: errorAbove ?? 1, endsAt: 1, level: "error" },
  ];
};

function zonesOf(handle: HandlerData | null): Zone[] {
  const thresholds = (handle ?? {}) as NoulThresholds;
  const firesBelow =
    thresholds.warn?.less_than !== undefined || thresholds.error?.less_than !== undefined;
  return firesBelow ? zonesFiringBelow(thresholds) : zonesFiringAbove(thresholds);
}

/** Where a rule fires: the colored side of the axis is the side that fires, so it shows polarity. */
function ThresholdBar({ rule, width = BAR_WIDTH }: { rule: RuleView; width?: number }) {
  const height = BAR_HEIGHT;
  const rects: { x: number; w: number; level: Level }[] = [];
  if (rule.kind === "noul") {
    for (const zone of zonesOf(rule.handle)) {
      if (zone.endsAt > zone.startsAt)
        rects.push({
          x: zone.startsAt * width,
          w: (zone.endsAt - zone.startsAt) * width,
          level: zone.level,
        });
    }
  } else {
    const tiers = tiersOf(rule);
    const each = width / Math.max(tiers.length, 1);
    tiers.forEach((tier, i) => rects.push({ x: i * each, w: each - 1, level: levelOf(tier) }));
  }
  return (
    <svg
      width={width}
      height={height + 4}
      role="img"
      aria-label={`${rule.name} thresholds`}
      data-testid="rule-bar"
    >
      {rects.map((r) => (
        <rect
          key={`${r.x}-${r.level}`}
          x={r.x}
          y={2}
          width={r.w}
          height={height}
          className={LEVEL_FILL[r.level]}
        />
      ))}
      {rule.kind === "noul" && (
        <line
          x1={width / 2}
          x2={width / 2}
          y1={0}
          y2={height + 4}
          strokeDasharray="2 2"
          className="stroke-foreground"
        />
      )}
    </svg>
  );
}

const SPARK_WIDTH = 112;
const SPARK_HEIGHT = 18;

/** Share of readings that fired in each of the last runs, one bar per run, newest at the right. */
function FireHistory({ rule }: { rule: RuleView }) {
  const step = SPARK_WIDTH / HISTORY;
  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      role="img"
      aria-label={`${rule.name} fire rate by run`}
    >
      {rule.runs.map((run, i) => {
        const share = run.n === 0 ? 0 : run.fired / run.n;
        const bar = Math.max(1, share * (SPARK_HEIGHT - 2));
        return (
          <rect
            key={run.id}
            x={(HISTORY - rule.runs.length + i) * step + 1}
            y={SPARK_HEIGHT - bar}
            width={step - 2}
            height={bar}
            className={share > 0 ? "fill-sev-warn" : "fill-border"}
          />
        );
      })}
    </svg>
  );
}

const lastRun = (rule: RuleView): RuleRun | undefined => rule.runs[rule.runs.length - 1];
const matches = (rule: RuleView, filter: Filter): boolean =>
  filter === "all" ? true : filter === "never" ? rule.runs.length === 0 : rule.kind === filter;

function FilterButtons({
  filter,
  onFilter,
  rules,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  rules: RuleView[];
}) {
  return (
    <div role="group" aria-label="filter rules" className="flex items-center gap-related">
      {FILTERS.map((f) => (
        <Button
          key={f}
          variant="secondary"
          size="sm"
          aria-pressed={filter === f}
          data-testid={`rules-filter-${f}`}
          onClick={() => onFilter(f)}
          className={filter === f ? "text-body" : "border border-input text-body"}
        >
          {FILTER_LABEL[f]} {rules.filter((rule) => matches(rule, f)).length}
        </Button>
      ))}
    </div>
  );
}

function Criteria({ rule }: { rule: RuleView }) {
  const tiers = tiersOf(rule);
  const rows: { label: string; text: string; level?: Level }[] = [];
  const criteria = rule.criteria as Record<string, string> | string[] | null;
  if (rule.kind === "noul" && criteria !== null && !Array.isArray(criteria)) {
    rows.push(
      { label: "true", text: criteria.true ?? "" },
      { label: "false", text: criteria.false ?? "" },
    );
  } else if (Array.isArray(criteria)) {
    criteria.forEach((text, i) => {
      const tier = tiers[i];
      rows.push({
        label: String(i),
        text,
        level: tier === undefined ? undefined : levelOf(tier),
      });
    });
  } else if (criteria !== null) {
    for (const label of Object.keys(criteria)) {
      const tier = (rule.handle as { choices?: Record<string, Tier> } | null)?.choices?.[label];
      rows.push({
        label,
        text: criteria[label] ?? "",
        level: tier === undefined ? undefined : levelOf(tier),
      });
    }
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-meta gap-y-related" data-testid="rule-criteria">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt
            className={
              row.level === undefined ? "font-medium" : `font-medium ${LEVEL_TEXT[row.level]}`
            }
          >
            {row.label}
          </dt>
          <dd>
            {row.text}
            {row.level !== undefined && (
              <span className="text-muted-foreground"> → {row.level}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const operator = (c: { greater_than?: number; less_than?: number }): string =>
  c.greater_than !== undefined ? `> ${c.greater_than}` : `< ${c.less_than}`;

function messagesOf(rule: RuleView): { level: Level; message: string }[] {
  const out: { level: Level; message: string }[] = [];
  if (rule.kind === "noul") {
    const handle = (rule.handle ?? {}) as Record<string, { message?: string } | undefined>;
    for (const level of ["warn", "error"] as const) {
      const message = handle[level]?.message;
      if (message !== undefined) out.push({ level, message });
    }
    return out;
  }
  for (const tier of tiersOf(rule)) {
    const message = messageOfTier(tier);
    if (message !== undefined) out.push({ level: levelOf(tier), message });
  }
  return out;
}

function RuleDialog({ rule, onClose }: { rule: RuleView | null; onClose: () => void }) {
  const noul = (rule?.handle ?? {}) as Record<
    string,
    { greater_than?: number; less_than?: number }
  >;
  const undecided =
    rule?.kind === "choice"
      ? (rule.handle as { undecided?: { margin: number; level: Level } } | null)?.undecided
      : undefined;
  return (
    <Dialog open={rule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl" data-testid="rule-dialog">
        {rule !== null && (
          <>
            <DialogHeader>
              <DialogTitle className="text-emphasis">{rule.name}</DialogTitle>
              <DialogDescription>{rule.kind} rule, read only</DialogDescription>
            </DialogHeader>
            <section className="flex flex-col gap-related">
              <h3 className="text-caption text-muted-foreground">instructions</h3>
              <p data-testid="rule-instructions" className="whitespace-pre-wrap">
                {rule.instructions ?? "Not recorded: the rule has not run since runs kept it."}
              </p>
            </section>
            <section className="flex flex-col gap-related">
              <h3 className="text-caption text-muted-foreground">
                {rule.kind === "noul" ? "criteria" : rule.kind === "choice" ? "choices" : "levels"}
              </h3>
              <Criteria rule={rule} />
              {undecided !== undefined && (
                <p className="text-muted-foreground">
                  undecided margin &lt; {undecided.margin} → {undecided.level}
                </p>
              )}
            </section>
            {rule.kind === "noul" && (
              <section className="flex flex-col gap-related">
                <h3 className="text-caption text-muted-foreground">thresholds</h3>
                <ThresholdBar rule={rule} width={300} />
                <p className="text-muted-foreground">
                  {(["warn", "error"] as const)
                    .filter((level) => noul[level] !== undefined)
                    .map((level) => `${level} ${operator(noul[level] ?? {})}`)
                    .join(" · ")}
                </p>
              </section>
            )}
            {messagesOf(rule).length > 0 && (
              <section className="flex flex-col gap-related">
                <h3 className="text-caption text-muted-foreground">messages</h3>
                {messagesOf(rule).map((m) => (
                  <p key={m.level + m.message}>
                    <span className={LEVEL_TEXT[m.level]}>{m.level}</span> {m.message}
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({ rule, onOpen }: { rule: RuleView; onOpen: () => void }) {
  const last = lastRun(rule);
  return (
    <tr
      data-testid="rule-row"
      onClick={onOpen}
      className="cursor-pointer border-b border-border hover:bg-muted"
    >
      <td className="whitespace-nowrap px-rail py-cell-y">
        <button
          type="button"
          data-testid="rule-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="cursor-pointer font-medium"
        >
          {rule.name}
        </button>
      </td>
      <td className="px-rail py-cell-y text-muted-foreground">{rule.kind}</td>
      <td className="px-rail py-cell-y">
        <ThresholdBar rule={rule} />
      </td>
      <td className="px-rail py-cell-y">
        <FireHistory rule={rule} />
      </td>
      <td className="whitespace-nowrap px-rail py-cell-y tabular-nums" data-testid="rule-last-run">
        {last === undefined ? (
          <span className="text-muted-foreground">never</span>
        ) : (
          <Link
            to="/runs/$runId"
            params={{ runId: last.id }}
            onClick={(event) => event.stopPropagation()}
          >
            …{last.id.slice(-6)}
          </Link>
        )}
      </td>
      <td className="px-rail py-cell-y tabular-nums text-muted-foreground">
        {last === undefined ? "–" : `${Math.round((last.cached / last.n) * 100)}%`}
      </td>
    </tr>
  );
}

export function Rules() {
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: 5_000,
  });
  const [kindFilter, setKindFilter] = useState<Filter>("all");
  const [openedRuleName, setOpenedRuleName] = useState<string | null>(null);
  const allRules = rulesQuery.data?.rules ?? [];
  const visibleRules = allRules.filter((rule) => matches(rule, kindFilter));
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-sections border-b border-border px-rail py-bar-y">
        <FilterButtons filter={kindFilter} onFilter={setKindFilter} rules={allRules} />
        {rulesQuery.data?.configPath != null && (
          <span className="ml-auto truncate text-muted-foreground" data-testid="rules-config">
            {rulesQuery.data.configPath}
          </span>
        )}
      </div>
      {rulesQuery.data?.configError !== undefined && (
        <p className="px-rail py-bar-y text-sev-warn" data-testid="rules-config-error">
          The config no longer loads, so only rules from stored runs are listed:{" "}
          {rulesQuery.data.configError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px]">
          <thead className="sticky top-0 z-10 border-b border-border bg-muted text-caption text-muted-foreground">
            <tr>
              {["rule", "kind", "thresholds", "fire rate, last 14 runs", "last run", "cached"].map(
                (heading) => (
                  <th key={heading} scope="col" className="px-rail py-bar-y text-left font-normal">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRules.map((rule) => (
              <RuleRow key={rule.name} rule={rule} onOpen={() => setOpenedRuleName(rule.name)} />
            ))}
          </tbody>
        </table>
        {!rulesQuery.isLoading && visibleRules.length === 0 && (
          <p className="px-rail py-sections text-muted-foreground" data-testid="rules-empty">
            No rule matches this filter.
          </p>
        )}
      </div>
      <RuleDialog
        rule={allRules.find((rule) => rule.name === openedRuleName) ?? null}
        onClose={() => setOpenedRuleName(null)}
      />
    </>
  );
}

/** The rules page: the app shell with the rules of the repo in place of a run. */
export function RulesPage() {
  const { theme, choose } = useTheme();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-sections border-b border-border bg-muted px-rail py-bar-y">
        <h1 className="flex items-center text-foreground">
          <Logo className="h-6 w-auto" />
        </h1>
        <Nav />
        <ThemeButtons theme={theme} choose={choose} />
      </header>
      <Rules />
    </div>
  );
}
