import { useState } from "react";
import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { QuizQuestion } from "~/components/lesson/QuizQuestion";
import { fetchPracticeQuiz, fetchRoadmapDetail } from "~/lib/api-client";

/**
 * Practice Quiz page — Screen 5 per UI-SPEC.
 *
 * Standalone knowledge reinforcement mode (D-13).
 * - One question at a time with instant feedback
 * - Progress indicator: "Question {N} of {M}"
 * - Score summary at end: "{X} of {M} correct"
 * - "Try again" resets with shuffled order; "Back to roadmap" navigates home
 * - Empty state when no lessons completed yet
 */

type QuizPhase = "quiz" | "summary";

export default function PracticeQuizPage() {
  const { id: roadmapId } = useParams<{ id: string }>();

  // Shuffled question order (re-randomized on "Try again")
  const [questionOrder, setQuestionOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [phase, setPhase] = useState<QuizPhase>("quiz");
  const [quizKey, setQuizKey] = useState(0); // forces re-mount on retry

  const {
    data: questions,
    isLoading: isLoadingQuiz,
  } = useQuery({
    queryKey: ["practice-quiz", roadmapId],
    queryFn: () => fetchPracticeQuiz(roadmapId!),
    enabled: !!roadmapId,
    select: (data) => data,
  });

  const {
    data: roadmap,
    isLoading: isLoadingRoadmap,
  } = useQuery({
    queryKey: ["roadmap", roadmapId],
    queryFn: () => fetchRoadmapDetail(roadmapId!),
    enabled: !!roadmapId,
  });

  const isLoading = isLoadingQuiz || isLoadingRoadmap;

  // Initialize / re-initialize question order when questions load or on retry
  // We use a stable order derived from questionOrder state + questions array
  const orderedQuestions =
    questions && questionOrder.length === questions.length
      ? questionOrder.map((i) => questions[i])
      : questions ?? [];

  // Initialize order on first load
  if (questions && questionOrder.length !== questions.length) {
    const indices = questions.map((_, i) => i);
    // Shuffle indices for randomized order
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setQuestionOrder(indices);
  }

  // ─── Loading State ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="px-4 pb-8">
        <div className="flex items-center gap-1 pt-6 mb-4">
          <Skeleton className="h-5 w-28 rounded" />
        </div>
        <Skeleton className="h-7 w-2/3 rounded mb-6" />
        <Skeleton className="w-full h-48 rounded-lg" />
      </div>
    );
  }

  // ─── Empty State (no completed lessons) ───────────────────────────────────────
  if (!questions || questions.length === 0) {
    return (
      <div className="px-4 pb-8">
        <div className="pt-6 mb-4">
          <Link
            to={`/roadmaps/${roadmapId}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 w-fit"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-xl font-semibold leading-tight mb-1">
            Practice Quiz
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-base text-muted-foreground max-w-xs">
            Complete at least one lesson before taking a practice quiz.
          </p>
          <Button variant="default" asChild>
            <Link to={`/roadmaps/${roadmapId}`}>Go to roadmap</Link>
          </Button>
        </div>
      </div>
    );
  }

  const totalQuestions = orderedQuestions.length;
  const currentQuestion = orderedQuestions[currentIndex];
  const correctCount = Object.values(answers).filter(Boolean).length;
  const isLastQuestion = currentIndex === totalQuestions - 1;
  const isCurrentAnswered = answers[currentIndex] !== undefined;

  const roadmapTitle = roadmap?.title ?? "Roadmap";

  function handleAnswered(correct: boolean) {
    setAnswers((prev) => ({ ...prev, [currentIndex]: correct }));
  }

  function handleNext() {
    if (!isLastQuestion) {
      setCurrentIndex((i) => i + 1);
    } else {
      setPhase("summary");
    }
  }

  function handleRetry() {
    if (!questions) return;
    // Re-shuffle and reset all state
    const indices = questions.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setQuestionOrder(indices);
    setCurrentIndex(0);
    setAnswers({});
    setPhase("quiz");
    setQuizKey((k) => k + 1);
  }

  // ─── Score Summary ────────────────────────────────────────────────────────────
  if (phase === "summary") {
    return (
      <div className="px-4 pb-8">
        <div className="pt-6 mb-6">
          <Link
            to={`/roadmaps/${roadmapId}`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 w-fit"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-xl font-semibold leading-tight">Practice Quiz</h1>
        </div>

        <Card className="p-6 text-center">
          <p className="text-base text-muted-foreground mb-2">
            Quiz: {roadmapTitle}
          </p>
          <p className="text-2xl font-semibold mb-1">
            {correctCount} of {totalQuestions} correct
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {correctCount === totalQuestions
              ? "Perfect score!"
              : correctCount === 0
              ? "Keep practicing — you'll get there."
              : "Nice effort. Keep reviewing to improve."}
          </p>
          <div className="flex flex-col gap-3">
            <Button variant="default" className="w-full" onClick={handleRetry}>
              Try again
            </Button>
            <Button variant="outline" className="w-full" asChild>
              <Link to={`/roadmaps/${roadmapId}`}>Back to roadmap</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Quiz State ───────────────────────────────────────────────────────────────
  return (
    <div className="px-4 pb-8">
      {/* Page header */}
      <div className="pt-6 mb-6">
        <Link
          to={`/roadmaps/${roadmapId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 w-fit"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="text-xl font-semibold leading-tight">
          Quiz: {roadmapTitle}
        </h1>
      </div>

      {/* Progress indicator */}
      <p className="text-sm text-muted-foreground mb-4">
        Question {currentIndex + 1} of {totalQuestions}
      </p>

      {/* Current question */}
      {currentQuestion && (
        <QuizQuestion
          key={`${quizKey}-${currentIndex}`}
          question={currentQuestion}
          onAnswered={handleAnswered}
        />
      )}

      {/* Next / Finish navigation */}
      {isCurrentAnswered && (
        <Button
          variant="default"
          className="w-full mt-2"
          onClick={handleNext}
        >
          {isLastQuestion ? "See results" : "Next question"}
        </Button>
      )}
    </div>
  );
}
