import { useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { Card } from "~/components/ui/card";
import { submitQuizAnswer } from "~/lib/api-client";
import type { QuizQuestion as QuizQuestionType, QuizAnswerResult } from "~/lib/api-client";

interface QuizQuestionProps {
  question: QuizQuestionType;
  onAnswered: (correct: boolean) => void;
}

type AnswerState =
  | { phase: "idle" }
  | { phase: "submitting"; selectedOptionId: string }
  | { phase: "answered"; selectedOptionId: string; result: QuizAnswerResult };

/**
 * Reusable quiz question component with instant per-question feedback.
 *
 * - Auto-submits on tap (no confirm step) per D-12
 * - Correct: accent border (border-primary), CheckCircle icon
 * - Wrong: destructive border (border-destructive), XCircle icon; correct option gets accent border
 * - No green color — correct uses accent (blue), wrong uses destructive (red) per UI-SPEC
 * - role="radiogroup" / role="radio" for accessibility
 * - role="alert" feedback container announces correct/wrong to screen readers
 */
export function QuizQuestion({ question, onAnswered }: QuizQuestionProps) {
  const [state, setState] = useState<AnswerState>({ phase: "idle" });

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
    } catch {
      // On error, reset to idle so user can retry
      setState({ phase: "idle" });
    }
  }

  function getOptionStyle(optionId: string): string {
    const base =
      "flex items-center gap-3 w-full min-h-[52px] px-4 py-3 rounded-lg border transition-colors text-left";

    if (state.phase === "idle" || state.phase === "submitting") {
      const isSelected =
        state.phase === "submitting" && state.selectedOptionId === optionId;
      return `${base} border-border bg-card ${isSelected ? "opacity-70" : "hover:bg-muted/50 cursor-pointer"}`;
    }

    // Answered state
    const { selectedOptionId, result } = state;
    const isSelected = selectedOptionId === optionId;
    const isCorrectOption = result.correctOptionId === optionId;

    if (isSelected && result.correct) {
      // Correct selection: accent border
      return `${base} border-primary bg-card pointer-events-none`;
    }
    if (isSelected && !result.correct) {
      // Wrong selection: destructive border
      return `${base} border-destructive bg-card pointer-events-none`;
    }
    if (!isSelected && isCorrectOption && !result.correct) {
      // Show the correct option with accent border when user got it wrong
      return `${base} border-primary bg-card pointer-events-none`;
    }
    // All other options: neutral, non-interactive
    return `${base} border-border bg-card pointer-events-none opacity-50`;
  }

  function getOptionIcon(optionId: string) {
    if (state.phase !== "answered") {
      // Radio-style indicator: unfilled circle
      return (
        <span
          className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-muted-foreground"
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
          className="flex-shrink-0 h-5 w-5 text-primary"
          aria-hidden="true"
        />
      );
    }
    if (isSelected && !result.correct) {
      return (
        <XCircle
          className="flex-shrink-0 h-5 w-5 text-destructive"
          aria-hidden="true"
        />
      );
    }
    if (!isSelected && isCorrectOption && !result.correct) {
      return (
        <CheckCircle
          className="flex-shrink-0 h-5 w-5 text-primary"
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="flex-shrink-0 h-5 w-5 rounded-full border-2 border-muted-foreground opacity-50"
        aria-hidden="true"
      />
    );
  }

  const answeredState = state.phase === "answered" ? state : null;

  return (
    <Card className="p-4 mb-4">
      {/* Question text */}
      <p className="text-base leading-relaxed mb-4">{question.question}</p>

      {/* Options */}
      <div
        role="radiogroup"
        aria-label={question.question}
        className={`flex flex-col gap-2 ${!isInteractive ? "pointer-events-none" : ""}`}
      >
        {question.options.map((option) => {
          const isSelectedOption =
            (state.phase === "submitting" || state.phase === "answered") &&
            state.selectedOptionId === option.id;

          return (
            <button
              key={option.id}
              role="radio"
              aria-checked={isSelectedOption}
              disabled={isSubmitting || isAnswered}
              className={getOptionStyle(option.id)}
              onClick={() => handleOptionSelect(option.id)}
              type="button"
            >
              {getOptionIcon(option.id)}
              <span className="text-sm leading-snug">{option.text}</span>
            </button>
          );
        })}
      </div>

      {/* Feedback — announced to screen readers via role="alert" */}
      {answeredState && (
        <div role="alert" className="mt-4 pt-3 border-t border-border">
          <p
            className={`text-sm font-semibold mb-1 ${
              answeredState.result.correct
                ? "text-primary"
                : "text-destructive"
            }`}
          >
            {answeredState.result.correct ? "Correct" : "Incorrect"}
          </p>
          {answeredState.result.explanation && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {answeredState.result.explanation}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
