import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { LessonContent } from "~/components/lesson/LessonContent";
import { QuizQuestion } from "~/components/lesson/QuizQuestion";
import { InLessonQASheet } from "~/components/qa/InLessonQASheet";
import { fetchLesson, completeLesson } from "~/lib/api-client";
import { getLocalTimezone } from "~/lib/utils";

/**
 * Lesson view page — Phase 06 Plan 03 / UI-SPEC § Lesson Reader.
 *
 * Layout:
 * - Top frosted bar (sticky below AppShell): back + lesson title + progress dots
 * - Article body: max-w 680px, body 16/1.5, generous vertical rhythm
 * - Bottom frosted action bar (sticky): "Mark complete" + Q&A icon button
 *   (`aria-label="Ask Mimir about this lesson"`) opening InLessonQASheet
 *   (`Sheet variant="frosted"`).
 *
 * Quiz flow preserved verbatim from prior implementation:
 * - "Knowledge Check" divider + per-question feedback (3-phase state machine)
 * - One question visible at a time; "Next question" / "Finish lesson" advances
 * - "Mark complete" appears after the user taps "Finish lesson"
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
  // True once user taps "Finish lesson" — reveals "Mark complete" button
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
      <div className="pb-32">
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
    const tz = getLocalTimezone();
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

  // Progress dots — one per question. Filled = answered (regardless of correct);
  // current = ring; remaining = neutral. Dots are decorative; aria-hidden.
  const progressDots = totalQuestions > 0 && !quizFinished;

  // ─── Data State ───────────────────────────────────────────────────────────────
  return (
    <div className="pb-32">
      {/* Top frosted bar — sticks just below the AppShell status bar (h-14). */}
      <header className="sticky top-14 z-30 flex items-center gap-3 border-b border-[hsl(var(--border))] bg-[var(--bg-frosted)] backdrop-blur-md supports-[not_(backdrop-filter:blur(16px))]:bg-card px-4 py-3">
        <Link
          to={`/roadmaps/${roadmapId}`}
          aria-label="Back to roadmap"
          className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] text-[hsl(var(--fg-muted))] transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h2 className="min-w-0 truncate text-[18px] font-medium leading-[1.3] text-foreground">
          {lesson.title}
        </h2>
        {progressDots && (
          <div className="ml-auto flex items-center gap-1.5" aria-hidden="true">
            {questions.map((q, idx) => {
              const isAnswered = answeredQuestions[idx] !== undefined;
              const isCurrent = idx === currentQuestionIndex;
              return (
                <span
                  key={q.id}
                  className={
                    isAnswered
                      ? "h-2 w-2 rounded-full bg-[hsl(var(--dominant))]"
                      : isCurrent
                        ? "h-2 w-2 rounded-full ring-2 ring-[hsl(var(--dominant))]"
                        : "h-2 w-2 rounded-full bg-[hsl(var(--border))]"
                  }
                />
              );
            })}
          </div>
        )}
      </header>

      {/* Article body — max-w 680px, body 16/1.5, generous vertical rhythm. */}
      <article className="mx-auto max-w-[680px] px-6 py-6 [&>*+*]:mt-6">
        <LessonContent content={lesson.content} />

        {/* Quiz section */}
        {totalQuestions > 0 && (
          <div className="mt-6">
            {/* "Knowledge Check" divider */}
            <div className="relative my-6">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] whitespace-nowrap">
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

            {/* Navigation buttons after each answer (CTA copy lock per UI-SPEC) */}
            {!quizFinished && isCurrentQuestionAnswered && (
              <>
                {!isLastQuestion && (
                  <Button
                    variant="default"
                    className="w-full mt-2"
                    onClick={handleNextQuestion}
                  >
                    Next
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

            {/* Mark complete — visible after user taps "Finish lesson" */}
            {quizFinished && (
              <Button
                variant="default"
                className="w-full mt-4"
                onClick={handleCompleteLesson}
                disabled={isCompleting}
              >
                {isCompleting ? "Completing..." : "Mark complete"}
              </Button>
            )}
          </div>
        )}

        {/* No quiz questions — show Mark complete directly */}
        {totalQuestions === 0 && (
          <div className="mt-6">
            <Button
              variant="default"
              className="w-full"
              onClick={handleCompleteLesson}
              disabled={isCompleting}
            >
              {isCompleting ? "Completing..." : "Mark complete"}
            </Button>
          </div>
        )}
      </article>

      {/* Bottom frosted action bar — primary CTA + Q&A icon button. */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-30 flex items-center gap-3 border-t border-[hsl(var(--border))] bg-[var(--bg-frosted)] backdrop-blur-md supports-[not_(backdrop-filter:blur(16px))]:bg-card px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <Button
          variant="default"
          className="flex-1"
          onClick={handleCompleteLesson}
          disabled={isCompleting || (totalQuestions > 0 && !quizFinished)}
        >
          {isCompleting ? "Completing..." : "Mark complete"}
        </Button>
        <Button
          id="ask-ai-btn"
          variant="ghost"
          size="icon"
          onClick={handleAskAI}
          type="button"
          aria-label="Ask Mimir about this lesson"
          className="shrink-0"
        >
          <MessageCircleQuestion className="h-5 w-5" />
        </Button>
      </div>

      {/* In-lesson Q&A bottom sheet (QNA-01, D-17) — frosted variant. */}
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
