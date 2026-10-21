import {
  asTier,
  choiceTierMass,
  readChoice,
  type ChoiceHandlerData,
  type HandlerLevel,
} from "@jint/contract";
import { SEVERITY, TIER } from "./color";

export interface QA {
  key: string;
  rule: string;
  /** Criteria: {true, false} for noul, option label -> meaning for choice. */
  question: { type?: string; instructions?: string; criteria?: Record<string, string> };
  answer?: {
    type?: string;
    noul?: number;
    score?: number;
    choice?: string;
    confidence?: number;
    legend?: Record<string, string>;
    probabilities?: Record<string, number>;
  };
}

/**
 * One question = its criteria side by side + its LARGE answer. Score answers render the rounded
 * index as the protagonist plus the legend and the probability distribution (neutral bars - shape,
 * not verdict); choice answers render the verdict their tier read reached - each option's
 * probability summed into its tier - with the winning tier's bars in its color, keyed by label;
 * verdict color comes only from the card's own span-aware severity, never from a sibling
 * element's.
 */
type Threshold = { greater_than?: number; less_than?: number };

/** The noul gates from the run manifest, so a reading reads against its own thresholds. */
function thresholdText(threshold: Threshold | undefined): string | null {
  if (threshold === undefined) return null;
  if (threshold.greater_than !== undefined) return `> ${threshold.greater_than}`;
  if (threshold.less_than !== undefined) return `< ${threshold.less_than}`;
  return null;
}

/**
 * The CONFIDENCE VISIBILITY FLOOR (same 0.25 as the CLI's human print): below it the answer was
 * torn between distant levels (in practice 0, bimodal) and the card says so structurally - a dashed
 * amber frame on the answer header - not just as a number. The request's raw confidence always
 * prints in the caption; the floor only adds the frame.
 */
const CONFIDENCE_FLOOR = 0.25;

export function AnswerCard({
  qa,
  sev,
  handle,
  choices,
}: {
  qa: QA;
  sev: "error" | "warn" | null;
  handle?: { warn?: Threshold; error?: Threshold };
  /** The choice rule's handle: each option's tier, so the card can show the tier read. */
  choices?: ChoiceHandlerData;
}) {
  const noul = qa.answer?.noul;
  const score = qa.answer?.score;
  const isScore = qa.answer?.type === "score" || (noul === undefined && score !== undefined);
  const index = isScore && score !== undefined ? Math.round(score) : null;
  const choice = qa.answer?.type === "choice" ? qa.answer.choice : undefined;
  const isChoice = choice !== undefined;
  // the answered option: a score's rounded level, or the selected choice label
  const answeredKey = isChoice ? choice : index !== null ? String(index) : null;
  const ranked = isScore || isChoice;
  // a choice answer carries no legend: the options and their meanings live in the question
  const legend = isChoice ? (qa.question.criteria ?? {}) : isScore ? (qa.answer?.legend ?? {}) : {};
  const probabilities = ranked ? (qa.answer?.probabilities ?? {}) : {};
  // verdict color ONLY from severity; an unprovable answer stays neutral
  const color = sev !== null ? SEVERITY[sev].text : "text-foreground";
  // torn: the distribution is split between distant levels; the header frames itself so a
  // coin-flip never reads as a settled verdict
  const torn = qa.answer?.confidence !== undefined && qa.answer.confidence < CONFIDENCE_FLOOR;
  // score levels sort numerically; choice options keep the question's own order
  const options = Object.keys({ ...legend, ...probabilities });
  if (isScore) options.sort((x, y) => Number(x) - Number(y));
  // the choice tier read: the verdict is the tier holding the most probability, not jev's pick
  const tierRead =
    isChoice && choices !== undefined
      ? (() => {
          const mass = choiceTierMass(choices, probabilities);
          const fired = readChoice(choices, choice, probabilities);
          const tierOf = (k: string): HandlerLevel | undefined =>
            choices.choices[k] === undefined ? undefined : asTier(choices.choices[k]).level;
          const verdict: HandlerLevel | "undecided" = fired?.undecided
            ? "undecided"
            : (fired?.severity ?? "pass");
          // the sum that set a tier's mass, for the hover on each of its bars
          const sum = (tier: HandlerLevel): string => {
            const parts = options.filter((k) => tierOf(k) === tier);
            const terms = parts.map((k) => `${k} ${(probabilities[k] ?? 0).toFixed(2)}`);
            return `${tier}: ${terms.join(" + ")}${parts.length > 1 ? ` = ${mass[tier].toFixed(2)}` : ""}`;
          };
          const ranking = (["error", "warn", "pass"] as const)
            .filter((t) => options.some((k) => tierOf(k) === t))
            .sort((a, b) => mass[b] - mass[a]);
          return { mass, verdict, tierOf, sum, ranking };
        })()
      : null;
  // the emphasized options: the verdict tier's options under a tier read, else the answered one
  const emphasized = (k: string): boolean =>
    tierRead !== null ? tierRead.verdict === tierRead.tierOf(k) : k === answeredKey;
  return (
    <div className="pt-siblings">
      <div
        data-torn-answer={torn ? "true" : undefined}
        className={`flex items-center gap-sections border-b border-border px-rail pb-siblings ${
          torn ? "border-dashed border-amber-400/70 bg-amber-400/[0.05]" : ""
        }`}
      >
        {noul !== undefined && (
          <span className="flex items-baseline gap-siblings">
            <span
              data-answer={noul.toFixed(2)}
              className={`text-3xl font-bold leading-none ${color}`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {noul.toFixed(2)}
            </span>
            {handle !== undefined && (
              <span data-testid="noul-thresholds" className="text-caption text-muted-foreground">
                {["warn", "error"]
                  .map((level) => {
                    const text = thresholdText(handle[level as "warn" | "error"]);
                    return text === null ? null : `${level} ${text}`;
                  })
                  .filter((part) => part !== null)
                  .join(" \u00b7 ")}
              </span>
            )}
          </span>
        )}
        {isScore && index !== null && (
          <span className="flex items-baseline gap-siblings">
            <span
              data-answer={String(index)}
              className={`text-3xl font-bold leading-none ${color}`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {index}
            </span>
            <span className="text-caption text-muted-foreground">
              score {qa.answer?.score?.toFixed(2)}
              {qa.answer?.confidence !== undefined && (
                <span className={torn ? "text-sev-warn" : undefined}>
                  {` · confidence ${qa.answer.confidence.toFixed(2)}`}
                  {torn ? " · torn between levels" : ""}
                </span>
              )}
            </span>
          </span>
        )}
        {isChoice && (
          <span className="flex items-baseline gap-siblings">
            <span
              data-answer={choice}
              data-verdict={tierRead?.verdict}
              className={`text-3xl font-bold leading-none ${
                tierRead?.verdict === "pass" ? "text-sev-clean" : color
              }`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {tierRead?.verdict ?? choice}
            </span>
            <span className="text-caption text-muted-foreground">
              {tierRead !== null
                ? tierRead.ranking.map((t) => `${t} ${tierRead.mass[t].toFixed(2)}`).join(" vs ")
                : `p ${(probabilities[choice] ?? 0).toFixed(2)}`}
              {qa.answer?.confidence !== undefined && (
                <span className={torn ? "text-sev-warn" : undefined}>
                  {` · confidence ${qa.answer.confidence.toFixed(2)}`}
                  {torn ? " · torn between options" : ""}
                </span>
              )}
            </span>
          </span>
        )}
      </div>
      {answeredKey !== null && ranked && (
        <div className="border-b border-border px-rail pb-siblings">
          {Object.keys(legend).length > 0 && (
            <span className="text-caption text-muted-foreground">criteria</span>
          )}
          {/* the distribution is the BAR strip: one bar per criterion option, labeled by its
              index, height = its probability, the answered level emphasized. The legend list
              below stays prose - the numbers moved into the bars */}
          <ul
            data-testid="answer-distribution"
            aria-label="answer distribution"
            className="mt-related flex flex-wrap items-end gap-chip-x"
          >
            {options.map((k) => {
              const prob = probabilities[k] ?? 0;
              const answered = emphasized(k);
              const tier = tierRead?.tierOf(k);
              // the winning tier's bars carry its color; an undecided read colors every bar by its
              // tier, since the split between tiers is the reading
              const tierColor =
                tier !== undefined &&
                (tierRead?.verdict === tier || tierRead?.verdict === "undecided")
                  ? TIER[tier]
                  : null;
              return (
                <li
                  key={k}
                  data-option={k}
                  data-probability={prob}
                  data-tier={tier}
                  // option labels are words, score levels are digits: a choice bar grows to its label
                  className={`flex flex-col items-center gap-chip-y ${isChoice ? "min-w-8" : "w-8"}`}
                >
                  <span
                    className="flex h-8 w-full items-end overflow-hidden rounded-xs bg-muted"
                    aria-hidden="true"
                    title={tier !== undefined ? tierRead?.sum(tier) : undefined}
                  >
                    <span
                      className={`w-full rounded-xs ${
                        tierRead !== null
                          ? (tierColor ?? "bg-foreground/30")
                          : answered
                            ? "bg-foreground/70"
                            : "bg-foreground/30"
                      }`}
                      style={{ height: `${Math.max(prob * 100, prob > 0 ? 8 : 0)}%` }}
                    />
                  </span>
                  <span
                    className={`text-caption ${answered ? "text-foreground" : "text-muted-foreground"}`}
                    title={legend[k] !== undefined ? legend[k] : undefined}
                  >
                    {k}
                  </span>
                </li>
              );
            })}
          </ul>
          <ul className="mt-related space-y-related">
            {options
              .filter((k) => legend[k] !== undefined)
              .map((k) => (
                <li
                  key={k}
                  className={`text-body leading-snug ${
                    emphasized(k) ? "text-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {/* the option is the description's subtitle, so the descriptions start aligned */}
                  <span data-testid="criterion-label" className="block text-caption">
                    {k}
                  </span>
                  {legend[k]}
                </li>
              ))}
          </ul>
        </div>
      )}
      {qa.question.instructions && (
        <div className="border-b border-border px-rail pb-siblings">
          <span className="text-caption text-muted-foreground">instruction</span>
          <p className="mt-related text-body leading-snug text-foreground">
            {qa.question.instructions}
          </p>
        </div>
      )}
      {!ranked && (
        <div className="grid grid-cols-2 text-body leading-snug">
          <div className="bg-background px-rail py-related">
            <span className="text-caption text-sev-clean">true</span>
            <p className="mt-chip-y whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.true ?? "—"}
            </p>
          </div>
          <div className="border-l border-border bg-background px-rail py-related">
            <span className="text-caption text-sev-error">false</span>
            <p className="mt-chip-y whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.false ?? "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
