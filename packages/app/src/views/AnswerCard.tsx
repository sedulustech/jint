import { SEVERITY } from "./color";

export interface QA {
  key: string;
  rule: string;
  question: { type?: string; instructions?: string; criteria?: { true?: string; false?: string } };
  answer?: {
    type?: string;
    noul?: number;
    score?: number;
    confidence?: number;
    legend?: Record<string, string>;
    probabilities?: Record<string, number>;
  };
}

/**
 * One question = its criteria side by side + its LARGE answer. Score answers render the rounded
 * index as the protagonist plus the legend and the probability distribution (neutral bars - shape,
 * not verdict); verdict color comes only from the card's own span-aware severity, never from a
 * sibling element's.
 */
export function AnswerCard({ qa, sev }: { qa: QA; sev: "error" | "warn" | null }) {
  const noul = qa.answer?.noul;
  const score = qa.answer?.score;
  const isScore = qa.answer?.type === "score" || (noul === undefined && score !== undefined);
  const index = isScore && score !== undefined ? Math.round(score) : null;
  const legend = isScore ? (qa.answer?.legend ?? {}) : {};
  const probabilities = isScore ? (qa.answer?.probabilities ?? {}) : {};
  // verdict color ONLY from severity; an unprovable answer stays neutral
  const color = sev !== null ? SEVERITY[sev].text : "text-foreground";
  return (
    <div>
      <div className="flex items-center gap-sections">
        {noul !== undefined && (
          <span
            data-answer={noul.toFixed(2)}
            className={`text-3xl font-bold leading-none ${color}`}
            title={sev !== null ? `severity: ${sev}` : undefined}
          >
            {noul.toFixed(2)}
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
              {qa.answer?.confidence !== undefined &&
                ` · confidence ${qa.answer.confidence.toFixed(2)}`}
            </span>
          </span>
        )}
      </div>
      {isScore && index !== null && (
        <div>
          {/* the probability strip is omitted for score answers: the legend is the information */}
          <ul className="mt-related space-y-chip-y">
            {Object.keys(legend)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => (
                <li
                  key={k}
                  className={`text-caption leading-snug ${
                    Number(k) === index ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {k}: {legend[k]}
                  {probabilities[k] !== undefined && ` (${probabilities[k]})`}
                </li>
              ))}
          </ul>
        </div>
      )}
      {qa.question.instructions && (
        <p className="mt-related text-body leading-snug text-muted-foreground">
          {qa.question.instructions}
        </p>
      )}
      {!isScore && (
        <div className="mt-related grid grid-cols-2 gap-siblings text-body leading-snug">
          <div>
            <span className="text-caption text-sev-clean">true</span>
            <p className="mt-chip-y whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.true ?? "—"}
            </p>
          </div>
          <div>
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
