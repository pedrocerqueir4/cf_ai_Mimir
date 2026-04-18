import { CheckCircle, XCircle } from "lucide-react";
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
 * Battle-room question panel. Reuses the visual grammar of
 * `components/lesson/QuizQuestion.tsx` (radio-style circle + text, accent
 * border + CheckCircle on correct, destructive border + XCircle on wrong,
 * dim to 50% opacity on non-selected options once answered) with three
 * battle-specific deviations:
 *
 * 1. Question text renders at Heading 20/600 (not Body 16/400) — battle
 *    places the question in the visual focal point.
 * 2. After lock, before reveal: render "Waiting for {opponentName}…" where
 *    the lesson-variant renders the correct-answer explanation.
 * 3. NO explanation rendered on reveal. Explanation slows pacing; battle
 *    is velocity-focused. NO XP toast per question — wager is the reward.
 */
export function BattleQuestion({
  question,
  mySelectedOptionId,
  isAnswered,
  revealCorrectOptionId,
  opponentName,
  onSelect,
}: BattleQuestionProps) {
  const isRevealed = revealCorrectOptionId != null;
  const isInteractive = !isAnswered;

  function getOptionStyle(optionId: string): string {
    const base =
      "flex items-center gap-3 w-full min-h-[52px] px-4 py-3 rounded-lg border transition-colors text-left";

    if (!isAnswered) {
      return `${base} border-border bg-card hover:bg-muted/50 cursor-pointer`;
    }

    const isSelected = mySelectedOptionId === optionId;
    const isCorrectOption = revealCorrectOptionId === optionId;

    // Pre-reveal (answered but server hasn't revealed yet): selected
    // option sits on a neutral dim background; others go pointer-events-none.
    if (!isRevealed) {
      return `${base} border-border bg-card pointer-events-none ${
        isSelected ? "opacity-80" : "opacity-50"
      }`;
    }

    // Post-reveal: paint correct/wrong borders per QuizQuestion pattern.
    if (isSelected && isCorrectOption) {
      return `${base} border-primary bg-card pointer-events-none`;
    }
    if (isSelected && !isCorrectOption) {
      return `${base} border-destructive bg-card pointer-events-none`;
    }
    if (!isSelected && isCorrectOption) {
      return `${base} border-primary bg-card pointer-events-none`;
    }
    return `${base} border-border bg-card pointer-events-none opacity-50`;
  }

  function getOptionIcon(optionId: string) {
    if (!isAnswered || !isRevealed) {
      return (
        <span
          className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground"
          aria-hidden="true"
        />
      );
    }

    const isSelected = mySelectedOptionId === optionId;
    const isCorrectOption = revealCorrectOptionId === optionId;

    if (isCorrectOption) {
      return (
        <CheckCircle
          className="h-5 w-5 shrink-0 text-primary"
          aria-hidden="true"
        />
      );
    }
    if (isSelected && !isCorrectOption) {
      return (
        <XCircle
          className="h-5 w-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground opacity-50"
        aria-hidden="true"
      />
    );
  }

  return (
    <Card className="p-4">
      {/* Question text — Heading 20/600 per battle-room deviation from lesson QuizQuestion */}
      <p className="mb-4 text-xl font-semibold leading-snug">
        {question.questionText}
      </p>

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
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isAnswered}
              className={getOptionStyle(option.id)}
              onClick={() => onSelect(option.id)}
            >
              {getOptionIcon(option.id)}
              <span className="text-sm leading-snug">{option.text}</span>
            </button>
          );
        })}
      </div>

      {/* Pre-reveal waiting label — replaces lesson-quiz explanation slot. */}
      {isAnswered && !isRevealed && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-muted-foreground"
        >
          Waiting for {opponentName}&hellip;
        </p>
      )}

      {/* Post-reveal feedback heading — NO explanation body per battle spec. */}
      {isAnswered && isRevealed && (
        <div role="alert" className="mt-4 border-t border-border pt-3">
          {mySelectedOptionId === null ? (
            <p className="text-sm font-semibold text-muted-foreground">
              Time&rsquo;s up
            </p>
          ) : mySelectedOptionId === revealCorrectOptionId ? (
            <p className="text-sm font-semibold text-primary">Correct</p>
          ) : (
            <p className="text-sm font-semibold text-destructive">Incorrect</p>
          )}
        </div>
      )}
    </Card>
  );
}
