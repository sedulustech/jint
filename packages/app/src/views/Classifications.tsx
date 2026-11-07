import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchClassifications,
  postClassification,
  type ClassificationEdit,
  type ClassificationRecord,
} from "../api/client";
import type { QA } from "./AnswerCard";

const POLL_MS = 1_000;

interface Edit {
  instructions?: string;
  criteria: Record<string, string>;
  code?: string;
}

/**
 * The classifications of one address. Position 0 is the original; every classify files a
 * classification under the run (server side) and becomes the next position, so the iterations
 * cycle. The cards render the draft - the original question and code with the reader's edits laid
 * over them - and moving to an iteration loads its edit and its answer into the draft. The original
 * is never touched: position 0 always shows it.
 */
export function useClassifications(
  address: { runId: string; rule: string; input: string },
  qa: QA | undefined,
  code: string | null,
) {
  const { runId, rule, input } = address;
  const queryKey = ["classifications", runId, rule, input];
  const client = useQueryClient();
  // polled, so a classification filed from outside this page (the agent's) appears while you look
  const classifications =
    useQuery({
      queryKey,
      queryFn: () => fetchClassifications(runId, rule, input),
      refetchInterval: POLL_MS,
    }).data ?? [];
  const [position, setPosition] = useState(0);
  const [draft, setDraft] = useState<Edit>({ criteria: {} });
  // the reading on show and the edit it answered, so a later edit marks it stale, never hides it
  const [shown, setShown] = useState<{ answer: NonNullable<QA["answer"]>; baseline: string }>();

  const original = qa?.question.criteria ?? {};
  const instructions = draft.instructions ?? qa?.question.instructions ?? "";
  const merged: Record<string, string> = {
    ...Object.fromEntries(Object.entries(original)),
    ...draft.criteria,
  };
  // a score rubric is an array: its index is the level
  const criteria = Array.isArray(original) ? Object.values(merged) : merged;
  const text = draft.code ?? code ?? "";
  // what the server is sent: only what differs from the original, which it holds itself
  const patchOf = (d: Edit): ClassificationEdit => {
    const patch: ClassificationEdit = {};
    if (d.instructions !== undefined) patch.instructions = d.instructions;
    if (Object.keys(d.criteria).length > 0) patch.criteria = d.criteria;
    if (d.code !== undefined) patch.code = d.code;
    return patch;
  };
  const editKey = JSON.stringify(patchOf(draft));

  /** Load iteration `at` (0 = the original) into the draft. */
  const go = (at: number, from: ClassificationRecord[] = classifications) => {
    const t = at === 0 ? undefined : from[at - 1];
    setPosition(at);
    if (t === undefined) {
      setDraft({ criteria: {} });
      setShown(undefined);
      return;
    }
    const loaded: Edit = {
      instructions: t.question.instructions,
      criteria: Object.fromEntries(Object.entries(t.question.criteria ?? {})),
      code: t.state.content ?? t.state.source,
    };
    setDraft(loaded);
    setShown({
      answer: t.answer,
      baseline: JSON.stringify(patchOf(loaded)),
    });
  };

  const ask = useMutation({
    mutationFn: () => postClassification(runId, { rule, input }, patchOf(draft)),
    onSuccess: (filed) => {
      const next = [...classifications, filed];
      client.setQueryData(queryKey, next);
      setPosition(next.length);
      setShown({ answer: filed.answer, baseline: editKey });
    },
  });

  return {
    ask,
    position,
    total: classifications.length + 1,
    /** The answer at each position: the original first, then every filed classification. */
    answers: [qa?.answer, ...classifications.map((t) => t.answer)],
    /** The actor of each position: the rule read the original; the rest were filed. */
    filedBy: ["rule", ...classifications.map((t) => t.by ?? "user")] as (
      | "rule"
      | NonNullable<ClassificationRecord["by"]>
    )[],
    go,
    reset: () => go(0),
    /** The new reading on show; stale when the edit moved on after it. */
    asked: shown === undefined ? undefined : { stale: shown.baseline !== editKey },
    dirty:
      draft.instructions !== undefined ||
      draft.code !== undefined ||
      Object.keys(draft.criteria).length > 0,
    text,
    setText: (code: string) => setDraft((d) => ({ ...d, code })),
    /** The original with the draft applied and, at an iteration, its answer in place. */
    edited:
      qa === undefined
        ? undefined
        : {
            ...qa,
            question: { ...qa.question, instructions, criteria },
            answer: shown?.answer ?? qa.answer,
          },
    edit: {
      instructions: (value: string) => setDraft((d) => ({ ...d, instructions: value })),
      criteria: (key: string, value: string) =>
        setDraft((d) => ({ ...d, criteria: { ...d.criteria, [key]: value } })),
    },
  };
}
