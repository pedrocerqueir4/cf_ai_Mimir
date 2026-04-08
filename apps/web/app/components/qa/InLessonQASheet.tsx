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
        className="h-[60vh] p-0 flex flex-col"
        aria-label="Lesson Q&A"
        aria-modal="true"
        role="dialog"
        ref={inputRef}
      >
        {/* Sheet header */}
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
          <SheetTitle className="text-base font-semibold">
            Lesson Q&A
          </SheetTitle>
        </SheetHeader>

        {/* Q&A thread — fills remaining height */}
        <div className="flex-1 min-h-0 flex flex-col">
          <QAThread
            roadmapId={roadmapId}
            lessonId={lessonId}
            placeholder="Ask about this lesson..."
            emptyText="Ask anything about this lesson's content."
            onCitationClick={handleCitationClick}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
