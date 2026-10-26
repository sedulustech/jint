import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AnswerCard, type QA } from "./AnswerCard";

afterEach(cleanup);

// A choice answer: the selected option is the answer, one bar per option keyed by label, and the
// options' meanings come from the question (a choice answer carries no legend).
const choiceQA: QA = {
  key: "is_comment_justified",
  rule: "is_comment_justified",
  question: {
    type: "choice",
    instructions: "Which option fits?",
    criteria: {
      justified: "states what the code does",
      contradicted: "claims what the code does not",
    },
  },
  answer: {
    type: "choice",
    choice: "contradicted",
    probabilities: { justified: 0.3, contradicted: 0.7 },
  },
};

test("a choice answer renders the selected option and one bar per option", () => {
  const { container } = render(<AnswerCard qa={choiceQA} sev="error" />);
  expect(container.querySelector("[data-answer]")?.getAttribute("data-answer")).toBe(
    "contradicted",
  );
  const bars = [...container.querySelectorAll('[data-testid="answer-distribution"] > li')];
  expect(bars.map((b) => b.getAttribute("data-option"))).toEqual(["justified", "contradicted"]);
  expect(Number(bars[1]!.getAttribute("data-probability"))).toBeCloseTo(0.7);
  // the selected option's bar is the emphasized one
  const selected = container.querySelector(
    '[data-testid="answer-distribution"] li[data-option="contradicted"] [data-testid="option-bar"] > span',
  );
  expect(selected?.className).toContain("bg-foreground/70");
  // the true/false criteria grid is noul-only
  expect(container.textContent).not.toContain("true");
});

// jev picks justified, but the two error options together outweigh it: the error tier is the verdict
const splitQA: QA = {
  key: "is_comment_justified",
  rule: "is_comment_justified",
  question: {
    type: "choice",
    criteria: {
      justified: "states what it does",
      digression: "about another unit",
      provenance: "about the past",
    },
  },
  answer: {
    type: "choice",
    choice: "justified",
    probabilities: { justified: 0.43, digression: 0.3, provenance: 0.27 },
  },
};
const choices = {
  choices: { justified: "pass", digression: "error", provenance: "error" },
} as const;

test("a choice answer reads its verdict from the tier mass and colors the winning tier", () => {
  const { container } = render(<AnswerCard qa={splitQA} sev="error" choices={choices} />);
  expect(container.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe("error");
  const bar = (k: string) =>
    container.querySelector(
      `[data-testid="answer-distribution"] li[data-option="${k}"] [data-testid="option-bar"] > span`,
    );
  // the losing pass option stays gray; the options that summed into the verdict take its color
  expect(bar("justified")?.className).toContain("bg-foreground/30");
  expect(bar("digression")?.className).toContain("bg-sev-error");
  expect(bar("provenance")?.className).toContain("bg-sev-error");
  // the hover on a bar shows the sum its tier's mass came from
  const track = container.querySelector(
    '[data-testid="answer-distribution"] li[data-option="digression"] [data-testid="option-bar"]',
  );
  expect(track?.getAttribute("title")).toBe("error: digression 0.30 + provenance 0.27 = 0.57");
});

// A score answer from a model that does not echo the level texts (luna): the levels still read,
// because the legend comes from the question - the rule's own criteria, indexed by level.
const scoreQA: QA = {
  key: "is_literal_shared",
  rule: "is_literal_shared",
  question: { type: "score", criteria: ["none repeat", "some repeat", "many repeat"] },
  answer: { type: "score", score: 0.4, probabilities: { 0: 0.7, 1: 0.2, 2: 0.1 } },
};

test("a score answer shows each level's text from the question, not the model's echo", () => {
  const { container } = render(<AnswerCard qa={scoreQA} sev={null} />);
  const rows = [...container.querySelectorAll('[data-testid="answer-distribution"] > li')];
  expect(rows.map((r) => r.getAttribute("data-option"))).toEqual(["0", "1", "2"]);
  expect(rows[1]!.textContent).toContain("some repeat");
});
