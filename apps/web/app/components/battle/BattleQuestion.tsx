import { CheckCircle, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { CurrentQuestion } from "~/stores/battle-store";

interface BattleQuestionProps {
  question: CurrentQuestion;
  /** The option the local user picked (null until they click one). */
  mySelectedOptionId: string | null;
  /** True once the user has locked in their answer for this round. */
  isAnswered: boolean;
  /** Non-null once the server's `reveal` event has landed. */
  revealCorrectOptionId: string | null;
  /**
   * Label for the opponent — used in the "Waiting for {opponentName}…"
   * copy that appears AFTER the user answers but BEFORE reveal fires.
   */
  opponentName: string;
  /** Fired on option click. Consumer is responsible for sending WS message. */
  onSelect: (optionId: string) => void;
}

/**
 * Phase 06 Plan 03 — UI-SPEC § Battle Room question panel.
 *
 * Reuses inline-quiz motion vocabulary (`quiz-correct` halo pulse +
 * `quiz-wrong` translateX shake) on the user's selected chip post-reveal.
 * Light + dark in lockstep via `--success-soft` / `--destructive-soft`
 * tokens. All gated on `useReducedMotion()`.
 *
 * Server-authoritative scoring + atomic answer submission preserved
 * verbatim (Phase 04 SEC-06 lock).
 */
export function BattleQuestion({
  question,
  mySelectedOptionId,
  isAnswered,
  revealCorrectOptionId,
  opponentName,
  onSelect,
}: BattleQuestionProps) {
  const prefersReducedMotion = useReducedMotion();
  const isRevealed = revealCorrectOptionId != null;
  const isInteractive = !isAnswered;

  // UI-SPEC § Motion `quiz-correct` — emerald halo pulse.
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

  // UI-SPEC § Motion `quiz-wrong` — translateX shake.
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

    if (!isAnswered) {
      return cn(
        base,
        "border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-subtle))] hover:border-[hsl(var(--border-strong))] cursor-pointer",
      );
    }

    const isSelected = mySelectedOptionId === optionId;
    const isCorrectOption = revealCorrectOptionId === optionId;

    // Pre-reveal (answered but server hasn't revealed yet): selected
    // option sits on a neutral dim background; others go pointer-events-none.
    if (!isRevealed) {
      return cn(
        base,
        "border-[hsl(var(--border))] pointer-events-none",
        isSelected ? "opacity-80" : "opacity-50",
      );
    }

    // Post-reveal: paint correct/wrong tokens.
    if (isSelected && isCorrectOption) {
      return cn(
        base,
        "border-[hsl(var(--success))] bg-[hsl(var(--success-soft))] text-[hsl(var(--success))] pointer-events-none",
      );
    }
    if (isSelected && !isCorrectOption) {
      return cn(
        base,
        "border-[hsl(var(--destructive))] bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive))] pointer-events-none",
      );
    }
    if (!isSelected && isCorrectOption) {
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
    if (!isAnswered || !isRevealed) {
      return (
        <span
          className="h-5 w-5 shrink-0 rounded-full border-2 border-[hsl(var(--border-strong))]"
          aria-hidden="true"
        />
      );
    }

    const isSelected = mySelectedOptionId === optionId;
    const isCorrectOption = revealCorrectOptionId === optionId;

    if (isCorrectOption) {
      return (
        <CheckCircle
          className="h-5 w-5 shrink-0 text-[hsl(var(--success))]"
          aria-hidden="true"
        />
      );
    }
    if (isSelected && !isCorrectOption) {
      return (
        <XCircle
          className="h-5 w-5 shrink-0 text-[hsl(var(--destructive))]"
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="h-5 w-5 shrink-0 rounded-full border-2 border-[hsl(var(--border))] opacity-50"
        aria-hidden="true"
      />
    );
  }

  return (
    <Card className="p-4">
      {/* Question text — h2 22/1.25/600 centered max-w-600 per UI-SPEC. */}
      <h2 className="mx-auto mb-4 max-w-[600px] text-center text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] text-foreground">
        {question.questionText}
      </h2>

      <div
        role="radiogroup"
        aria-label={question.questionText}
        className={cn(
          "flex flex-col gap-2",
          !isInteractive && "pointer-events-none",
        )}
      >
        {question.options.map((option) => {
          const isSelected = mySelectedOptionId === option.id;
          const isCorrectOption = revealCorrectOptionId === option.id;

          // Apply quiz-correct / quiz-wrong motion on the user's locked
          // chip the moment the server reveals the answer.
          const animateOnReveal =
            isAnswered && isRevealed && isSelected
              ? isCorrectOption
                ? correctAnim
                : wrongAnim
              : undefined;

          return (
            <motion.button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isAnswered}
              animate={animateOnReveal}
              className={getOptionClasses(option.id)}
              onClick={() => onSelect(option.id)}
            >
              {getOptionIcon(option.id)}
              <span className="text-[14px] leading-[1.5]">{option.text}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Pre-reveal waiting label — replaces lesson-quiz explanation slot. */}
      {isAnswered && !isRevealed && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]"
        >
          Waiting for {opponentName}&hellip;
        </p>
      )}

      {/* Post-reveal feedback heading — NO explanation body per battle spec. */}
      {isAnswered && isRevealed && (
        <div
          role="alert"
          className="mt-4 border-t border-[hsl(var(--border))] pt-3"
        >
          {mySelectedOptionId === null ? (
            <p className="text-[14px] font-semibold leading-[1.5] text-[hsl(var(--fg-muted))]">
              Time&rsquo;s up
            </p>
          ) : mySelectedOptionId === revealCorrectOptionId ? (
            <p className="text-[14px] font-semibold leading-[1.5] text-[hsl(var(--success))]">
              Correct
            </p>
          ) : (
            <p className="text-[14px] font-semibold leading-[1.5] text-[hsl(var(--destructive))]">
              Wrong
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
