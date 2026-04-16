import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { LessonContent } from "~/components/lesson/LessonContent";
import { QuizQuestion } from "~/components/lesson/QuizQuestion";
import { InLessonQASheet } from "~/components/qa/InLessonQASheet";
import { fetchLesson, completeLesson } from "~/lib/api-client";

/**
 * Lesson view page — Screen 4 per UI-SPEC.
 *
 * Layout:
 * - Page header: Back button + lesson title
 * - Full-width scrollable: LessonContent at top, quiz section at bottom (D-10)
 * - Fixed footer: "Ask AI" button (Plan 07 will wire the bottom sheet)
 *
 * Quiz flow:
 * - "Knowledge Check" divider separates reading content from quiz
 * - One question visible at a time; "Next question" / "Finish lesson" progresses
 * - "Complete lesson" appears after all questions answered (after "Finish lesson" tap)
 */
export default function LessonPage() {
  const { id: roadmapId, lessonId } = useParams<{
    id: string;
    lessonId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Controls the in-lesson Q&A bottom sheet (Plan 07, D-17)
  const [qaOpen, setQaOpen] = useState(false);

  // Track which question index is currently visible (0-based)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Track which questions have been answered (keyed by index → correct boolean)
  const [answeredQuestions, setAnsweredQuestions] = useState<
    Record<number, boolean>
  >({});
  // True once user taps "Finish lesson" — reveals "Complete lesson" button
  const [quizFinished, setQuizFinished] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const {
    data: lesson,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["lesson", roadmapId, lessonId],
    queryFn: () => fetchLesson(roadmapId!, lessonId!),
    enabled: !!roadmapId && !!lessonId,
  });

  // ─── Loading State ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="pb-24">
        <div className="px-4 pt-6 mb-4">
          <Skeleton className="h-5 w-28 rounded mb-3" />
          <Skeleton className="h-7 w-3/4 rounded" />
        </div>
        <div className="max-w-[680px] mx-auto px-6 py-4 space-y-3">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-5/6 rounded" />
          <Skeleton className="h-4 w-4/5 rounded" />
        </div>
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────────────────
  if (isError || !lesson) {
    return (
      <div className="px-4 pb-8 pt-6">
        <Link
          to={`/roadmaps/${roadmapId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 w-fit"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Link>
        <p className="text-base text-muted-foreground">
          This lesson doesn&apos;t exist.
        </p>
      </div>
    );
  }

  // ─── Derived State ────────────────────────────────────────────────────────────
  const questions = lesson.questions ?? [];
  const totalQuestions = questions.length;
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const isCurrentQuestionAnswered =
    answeredQuestions[currentQuestionIndex] !== undefined;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  function handleAnswered(correct: boolean) {
    setAnsweredQuestions((prev) => ({
      ...prev,
      [currentQuestionIndex]: correct,
    }));
  }

  function handleNextQuestion() {
    setCurrentQuestionIndex((i) => i + 1);
  }

  function handleFinishLesson() {
    setQuizFinished(true);
  }

  async function handleCompleteLesson() {
    if (!roadmapId || !lessonId) return;
    setIsCompleting(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const result = await completeLesson(roadmapId, lessonId, tz);
      if (result.xpEarned > 0) {
        toast.success(`+${result.xpEarned} XP earned`, {
          description: `Completed: ${lesson?.title ?? "Lesson"}`,
        });
      }
      if (result.streakBonus > 0) {
        setTimeout(() => {
          toast.success(`+${result.streakBonus} XP bonus`, {
            description: "Streak active — keep it up!",
          });
        }, 300);
      }
      // Invalidate both roadmap detail (node states) and user stats (dashboard XP/streak)
      await queryClient.invalidateQueries({ queryKey: ["roadmap", roadmapId] });
      await queryClient.invalidateQueries({ queryKey: ["user", "stats"] });
      navigate(`/roadmaps/${roadmapId}`);
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
      setIsCompleting(false);
    }
  }

  function handleAskAI() {
    setQaOpen(true);
  }

  // ─── Data State ───────────────────────────────────────────────────────────────
  return (
    <div className="pb-24">
      {/* Page header */}
      <div className="px-4 pt-6 mb-4">
        <Link
          to={`/roadmaps/${roadmapId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 w-fit"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="text-xl font-semibold leading-tight">{lesson.title}</h1>
      </div>

      {/* Lesson reading content */}
      <LessonContent content={lesson.content} />

      {/* Quiz section */}
      {totalQuestions > 0 && (
        <div className="px-4 mt-6">
          {/* "Knowledge Check" divider */}
          <div className="relative my-6">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-sm text-muted-foreground whitespace-nowrap">
              Knowledge Check
            </span>
          </div>

          {/* Current question — hidden once quiz is finished */}
          {!quizFinished && currentQuestion && (
            <QuizQuestion
              key={currentQuestion.id}
              question={currentQuestion}
              onAnswered={handleAnswered}
            />
          )}

          {/* Navigation buttons after each answer */}
          {!quizFinished && isCurrentQuestionAnswered && (
            <>
              {!isLastQuestion && (
                <Button
                  variant="default"
                  className="w-full mt-2"
                  onClick={handleNextQuestion}
                >
                  Next question
                </Button>
              )}
              {isLastQuestion && (
                <Button
                  variant="default"
                  className="w-full mt-2"
                  onClick={handleFinishLesson}
                >
                  Finish lesson
                </Button>
              )}
            </>
          )}

          {/* Complete lesson — visible after user taps "Finish lesson" */}
          {quizFinished && (
            <Button
              variant="default"
              className="w-full mt-4"
              onClick={handleCompleteLesson}
              disabled={isCompleting}
            >
              {isCompleting ? "Completing..." : "Complete lesson"}
            </Button>
          )}
        </div>
      )}

      {/* No quiz questions — show Complete lesson directly */}
      {totalQuestions === 0 && (
        <div className="px-4 mt-6">
          <Button
            variant="default"
            className="w-full"
            onClick={handleCompleteLesson}
            disabled={isCompleting}
          >
            {isCompleting ? "Completing..." : "Complete lesson"}
          </Button>
        </div>
      )}

      {/* Fixed footer: "Ask AI" button (D-17) */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 bg-background border-t border-border px-4 py-3 flex justify-center">
        <Button
          id="ask-ai-btn"
          variant="outline"
          className="gap-2"
          onClick={handleAskAI}
          type="button"
        >
          <MessageCircle className="h-4 w-4" />
          Ask AI
        </Button>
      </div>

      {/* In-lesson Q&A bottom sheet (QNA-01, D-17) */}
      {roadmapId && lessonId && (
        <InLessonQASheet
          open={qaOpen}
          onOpenChange={setQaOpen}
          roadmapId={roadmapId}
          lessonId={lessonId}
        />
      )}
    </div>
  );
}
