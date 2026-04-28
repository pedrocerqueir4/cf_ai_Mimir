import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { QAThread } from "./QAThread";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InLessonQASheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmapId: string;
  lessonId: string;
}

// ─── InLessonQASheet ──────────────────────────────────────────────────────────

/**
 * Bottom sheet for in-lesson Q&A (D-17, UI-SPEC Screen 4).
 *
 * - side="bottom", 60% viewport height
 * - role="dialog", aria-label="Lesson Q&A", aria-modal="true"
 * - Focus trap provided by Sheet (Radix Dialog)
 * - On open: input receives focus
 * - On close: focus returns to "Ask AI" trigger button
 */
export function InLessonQASheet({
  open,
  onOpenChange,
  roadmapId,
  lessonId,
}: InLessonQASheetProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input when the sheet opens
  useEffect(() => {
    if (open) {
      // Short delay to let the animation start before focusing
      const timer = setTimeout(() => {
        // Input focus is managed inside QAThread via its own ref;
        // the sheet's first focusable element will receive focus from Radix.
        // This is a best-effort fallback for environments where Radix
        // does not auto-focus the first element.
        const sheetInput = document.querySelector<HTMLInputElement>(
          '[aria-label="Question input"]'
        );
        sheetInput?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Citation click handler: close the sheet, then navigate
  const handleCitationClick = useCallback(
    (citedLessonId: string) => {
      onOpenChange(false);
      // Navigation is handled in QAThread after this callback returns
      // We navigate here with a small delay to allow the sheet close animation
      setTimeout(() => {
        navigate(`/roadmaps/${roadmapId}/lessons/${citedLessonId}`);
      }, 160);
    },
    [onOpenChange, navigate, roadmapId]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        variant="frosted"
        className="h-[60vh] p-0 flex flex-col"
        aria-label="Lesson Q&A"
        aria-modal="true"
        role="dialog"
        ref={inputRef}
      >
        {/* Drag handle — UI-SPEC § Q&A Bottom Sheet */}
        <div
          aria-hidden="true"
          className="mx-auto h-1 w-12 rounded-full bg-[hsl(var(--border-strong))] my-2 shrink-0"
        />

        {/* Sheet header */}
        <SheetHeader className="px-4 pt-2 pb-2 border-b border-[hsl(var(--border))] shrink-0">
          <SheetTitle className="text-[16px] font-semibold leading-[1.5]">
            Lesson Q&A
          </SheetTitle>
        </SheetHeader>

        {/* Q&A thread — fills remaining height; placeholder copy lock per
            UI-SPEC § Copywriting Contract empty Q&A row. */}
        <div className="flex-1 min-h-0 flex flex-col">
          <QAThread
            roadmapId={roadmapId}
            lessonId={lessonId}
            placeholder="Ask Mimir anything about this lesson."
            emptyText="Ask Mimir anything about this lesson."
            onCitationClick={handleCitationClick}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
