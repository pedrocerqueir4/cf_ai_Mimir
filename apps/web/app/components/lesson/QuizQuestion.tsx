import { useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { submitQuizAnswer } from "~/lib/api-client";
import type {
  QuizQuestion as QuizQuestionType,
  QuizAnswerResult,
} from "~/lib/api-client";

interface QuizQuestionProps {
  question: QuizQuestionType;
  onAnswered: (correct: boolean) => void;
}

type AnswerState =
  | { phase: "idle" }
  | { phase: "submitting"; selectedOptionId: string }
  | { phase: "answered"; selectedOptionId: string; result: QuizAnswerResult };

/**
 * Phase 06 Plan 03 — UI-SPEC § Inline Quiz.
 *
 * Atomic 3-phase state machine preserved verbatim from Phase 02 (Submit
 * answer → locked → reveal). Phase 06 changes:
 * - Question text: h2 22/1.25/600 centered, max-w 600 (UI-SPEC contract)
 * - Answer chips: full-width <motion.button> consuming `--success-soft` /
 *   `--destructive-soft` post-lock; quiz-correct (halo pulse) and
 *   quiz-wrong (translateX shake) motion variants gated on
 *   `useReducedMotion()`.
 * - Live region: role="status" aria-live="polite" announces correct/wrong.
 * - CTA copy lock: pre-submit guidance reads "Submit answer" (sr-only +
 *   visible caption) → "Next" CTA owned by parent route.
 *
 * Auto-submit on tap preserved (Phase 02 D-12) — the chip itself is the
 * Submit affordance. The "Submit answer" caption is a hint, not a button.
 */
export function QuizQuestion({ question, onAnswered }: QuizQuestionProps) {
  const [state, setState] = useState<AnswerState>({ phase: "idle" });
  const queryClient = useQueryClient();
  const prefersReducedMotion = useReducedMotion();

  const isAnswered = state.phase === "answered";
  const isSubmitting = state.phase === "submitting";
  const isInteractive = state.phase === "idle";

  async function handleOptionSelect(optionId: string) {
    if (!isInteractive) return;

    setState({ phase: "submitting", selectedOptionId: optionId });

    try {
      const result = await submitQuizAnswer(question.id, optionId);
      setState({ phase: "answered", selectedOptionId: optionId, result });
      onAnswered(result.correct);
      if (result.xpEarned > 0) {
        toast.success(`+${result.xpEarned} XP earned`, {
          description: "Correct answer",
        });
        queryClient.invalidateQueries({ queryKey: ["user", "stats"] });
      }
    } catch {
      // On error, reset to idle so user can retry
      setState({ phase: "idle" });
    }
  }

  // UI-SPEC § Motion `quiz-correct` — emerald halo pulse. Reduced: no halo.
  const correctAnim = prefersReducedMotion
    ? undefined
    : {
        boxShadow: [
          "0 0 0 0 rgba(52, 211, 153, 0)",
          "0 0 24px 4px rgba(52, 211, 153, 0.45)",
          "0 0 0 0 rgba(52, 211, 153, 0)",
        ],
        transition: {
          duration: 0.32,
          ease: [0.34, 1.56, 0.64, 1] as const,
        },
      };

  // UI-SPEC § Motion `quiz-wrong` — translateX shake. Reduced: no shake.
  const wrongAnim = prefersReducedMotion
    ? undefined
    : {
        x: [-4, 4, -2, 2, 0],
        transition: {
          duration: 0.2,
          ease: [0.2, 0.8, 0.2, 1] as const,
        },
      };

  function getOptionClasses(optionId: string): string {
    const base =
      "flex w-full min-h-12 items-center gap-3 rounded-[var(--radius-md)] border bg-card px-4 py-3 text-left text-[16px] font-medium leading-[1.5] transition-colors";

    if (state.phase === "idle" || state.phase === "submitting") {
      const isSelected =
        state.phase === "submitting" && state.selectedOptionId === optionId;
      return cn(
        base,
        "border-[hsl(var(--border))]",
        !isSelected &&
          "hover:bg-[hsl(var(--bg-subtle))] hover:border-[hsl(var(--border-strong))] cursor-pointer",
        isSelected && "opacity-70",
      );
    }

    // Answered state
    const { selectedOptionId, result } = state;
    const isSelected = selectedOptionId === optionId;
    const isCorrectOption = result.correctOptionId === optionId;

    if (isSelected && result.correct) {
      return cn(
        base,
        "border-[hsl(var(--success))] bg-[hsl(var(--success-soft))] text-[hsl(var(--success))] pointer-events-none",
      );
    }
    if (isSelected && !result.correct) {
      return cn(
        base,
        "border-[hsl(var(--destructive))] bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive))] pointer-events-none",
      );
    }
    if (!isSelected && isCorrectOption && !result.correct) {
      return cn(
        base,
        "border-[hsl(var(--success))] bg-[hsl(var(--success-soft))] text-[hsl(var(--success))] pointer-events-none",
      );
    }
    return cn(
      base,
      "border-[hsl(var(--border))] pointer-events-none opacity-50",
    );
  }

  function getOptionIcon(optionId: string) {
    if (state.phase !== "answered") {
      // Radio-style indicator: unfilled circle
      return (
        <span
          className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-[hsl(var(--border-strong))]"
          aria-hidden="true"
        />
      );
    }

    const { selectedOptionId, result } = state;
    const isSelected = selectedOptionId === optionId;
    const isCorrectOption = result.correctOptionId === optionId;

    if (isSelected && result.correct) {
      return (
        <CheckCircle
          className="flex-shrink-0 h-5 w-5 text-[hsl(var(--success))]"
          aria-hidden="true"
        />
      );
    }
    if (isSelected && !result.correct) {
      return (
        <XCircle
          className="flex-shrink-0 h-5 w-5 text-[hsl(var(--destructive))]"
          aria-hidden="true"
        />
      );
    }
    if (!isSelected && isCorrectOption && !result.correct) {
      return (
        <CheckCircle
          className="flex-shrink-0 h-5 w-5 text-[hsl(var(--success))]"
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-[hsl(var(--border))] opacity-50"
        aria-hidden="true"
      />
    );
  }

  const answeredState = state.phase === "answered" ? state : null;

  return (
    <Card className="p-4 mb-4">
      {/* Question text — h2 22/1.25/600 centered max-w 600 per UI-SPEC. */}
      <h2 className="mx-auto mb-4 max-w-[600px] text-center text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] text-foreground">
        {question.question}
      </h2>

      {/* Pre-submit caption — UI-SPEC § Copywriting Contract CTA copy lock.
          Auto-submit on tap means the chip itself is the Submit affordance;
          the caption guides users + satisfies the "Submit answer" copy lock. */}
      {isInteractive && (
        <p className="mb-3 text-center text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))]">
          Submit answer by tapping an option below.
        </p>
      )}

      {/* Options */}
      <div
        role="radiogroup"
        aria-label={question.question}
        className={cn(
          "flex flex-col gap-2",
          !isInteractive && "pointer-events-none",
        )}
      >
        {question.options.map((option) => {
          const isSelectedOption =
            (state.phase === "submitting" || state.phase === "answered") &&
            state.selectedOptionId === option.id;

          // Apply quiz-correct / quiz-wrong motion to the selected chip on
          // the first frame after the answer is locked. Other chips animate
          // their bg via plain CSS transition (transition-colors).
          const animateOnAnswered =
            state.phase === "answered" && state.selectedOptionId === option.id
              ? state.result.correct
                ? correctAnim
                : wrongAnim
              : undefined;

          return (
            <motion.button
              key={option.id}
              role="radio"
              aria-checked={isSelectedOption}
              disabled={isSubmitting || isAnswered}
              animate={animateOnAnswered}
              className={getOptionClasses(option.id)}
              onClick={() => handleOptionSelect(option.id)}
              type="button"
            >
              {getOptionIcon(option.id)}
              <span className="text-[14px] leading-[1.5]">{option.text}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Live region — announces correct/wrong to screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {answeredState
          ? answeredState.result.correct
            ? "Correct"
            : "Wrong"
          : ""}
      </div>

      {/* Visible feedback panel */}
      {answeredState && (
        <div
          role="alert"
          className="mt-4 pt-3 border-t border-[hsl(var(--border))]"
        >
          <p
            className={cn(
              "mb-1 text-[14px] font-semibold leading-[1.5]",
              answeredState.result.correct
                ? "text-[hsl(var(--success))]"
                : "text-[hsl(var(--destructive))]",
            )}
          >
            {answeredState.result.correct ? "Correct" : "Incorrect"}
          </p>
          {answeredState.result.explanation && (
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              {answeredState.result.explanation}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
