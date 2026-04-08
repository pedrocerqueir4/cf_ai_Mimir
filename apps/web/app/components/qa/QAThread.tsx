import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Send } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { askQuestion, type QAResponse } from "~/lib/api-client";
import { cn } from "~/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Citation {
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
}

interface QAMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  isError?: boolean;
}

export interface QAThreadProps {
  roadmapId: string;
  /** If provided, scopes to this lesson (QNA-01); if omitted, full roadmap (QNA-02) */
  lessonId?: string;
  /** Input placeholder text */
  placeholder: string;
  /** Empty state text */
  emptyText: string;
  /** Optional callback invoked before citation navigation (e.g. close a sheet) */
  onCitationClick?: (lessonId: string) => void;
}

// ─── Citation text renderer ───────────────────────────────────────────────────

/**
 * Render answer text with inline citation links.
 * Citations from the `sources` array take precedence; the text pattern
 * `[Lesson N: Title]` is used as a fallback display label.
 */
function AnswerContent({
  content,
  citations,
  roadmapId,
  onCitationClick,
}: {
  content: string;
  citations: Citation[];
  roadmapId: string;
  onCitationClick?: (lessonId: string) => void;
}) {
  const navigate = useNavigate();

  // Build a map from display text patterns to citation data
  // Pattern: [Lesson N: Title] or [Lesson N] anywhere in the answer
  const citationMap = new Map<string, Citation>();
  for (const c of citations) {
    citationMap.set(`[Lesson ${c.lessonOrder}: ${c.lessonTitle}]`, c);
    citationMap.set(`[Lesson ${c.lessonOrder}]`, c);
  }

  function handleCitationClick(citation: Citation) {
    if (onCitationClick) {
      onCitationClick(citation.lessonId);
    }
    navigate(`/roadmaps/${roadmapId}/lessons/${citation.lessonId}`);
  }

  // Split content on citation patterns and render inline links
  const citationPatterns = Array.from(citationMap.keys());

  if (citationPatterns.length === 0) {
    return <span>{content}</span>;
  }

  // Build a regex that matches any citation pattern
  const escapedPatterns = citationPatterns.map((p) =>
    p.replace(/[[\]().*+?^${}|\\]/g, "\\$&")
  );
  const regex = new RegExp(`(${escapedPatterns.join("|")})`, "g");
  const parts = content.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const citation = citationMap.get(part);
        if (citation) {
          return (
            <a
              key={i}
              role="link"
              tabIndex={0}
              className="text-sm text-primary underline-offset-2 hover:underline cursor-pointer"
              onClick={() => handleCitationClick(citation)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCitationClick(citation);
                }
              }}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 bg-card rounded-2xl rounded-tl-sm w-fit max-w-[80%]">
      <span
        className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}

// ─── QAThread ─────────────────────────────────────────────────────────────────

export function QAThread({
  roadmapId,
  lessonId,
  placeholder,
  emptyText,
  onCitationClick,
}: QAThreadProps) {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollEl = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    }
  }, [messages, isLoading]);

  const handleSend = useCallback(async () => {
    const question = inputValue.trim();
    if (!question || isLoading) return;

    const userMessage: QAMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response: QAResponse = await askQuestion(
        question,
        roadmapId,
        lessonId
      );

      const assistantMessage: QAMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        citations: response.citations,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: QAMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Couldn't retrieve an answer. Try rephrasing your question.",
        isError: true,
        citations: [],
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      // Return focus to input after response
      inputRef.current?.focus();
    }
  }, [inputValue, isLoading, roadmapId, lessonId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Message area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        <div className="px-4 py-4 flex flex-col gap-3">
          {/* Empty state */}
          {isEmpty && (
            <div className="flex items-center justify-center h-32">
              <p className="text-base text-muted-foreground text-center">
                {emptyText}
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="px-4 py-3 bg-foreground/8 rounded-2xl rounded-tr-sm max-w-[80%]">
                    <p className="text-base">{msg.content}</p>
                  </div>
                </div>
              );
            }

            // Assistant message
            return (
              <div key={msg.id} className="flex justify-start">
                <div
                  className={cn(
                    "px-4 py-3 bg-card rounded-2xl rounded-tl-sm max-w-[80%]",
                    msg.isError && "border border-destructive"
                  )}
                >
                  <p className="text-base">
                    <AnswerContent
                      content={msg.content}
                      citations={msg.citations ?? []}
                      roadmapId={roadmapId}
                      onCitationClick={onCitationClick}
                    />
                  </p>

                  {/* Inline citation list below answer */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {msg.citations.map((c) => (
                        <CitationTag
                          key={c.lessonId}
                          citation={c}
                          roadmapId={roadmapId}
                          onCitationClick={onCitationClick}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <TypingIndicator />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Fixed bottom input bar */}
      <div className="px-4 py-3 border-t border-border flex items-center gap-2 bg-background">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
          className="flex-1"
          aria-label="Question input"
        />
        <Button
          variant="default"
          size="icon"
          className="min-h-12 min-w-12 shrink-0"
          onClick={() => void handleSend()}
          disabled={!inputValue.trim() || isLoading}
          aria-label="Send question"
          type="button"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Citation tag (standalone clickable pill) ─────────────────────────────────

function CitationTag({
  citation,
  roadmapId,
  onCitationClick,
}: {
  citation: Citation;
  roadmapId: string;
  onCitationClick?: (lessonId: string) => void;
}) {
  const navigate = useNavigate();

  function handleClick() {
    if (onCitationClick) {
      onCitationClick(citation.lessonId);
    }
    navigate(`/roadmaps/${roadmapId}/lessons/${citation.lessonId}`);
  }

  return (
    <a
      role="link"
      tabIndex={0}
      className="text-sm text-primary underline-offset-2 hover:underline cursor-pointer"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      [Lesson {citation.lessonOrder}: {citation.lessonTitle}]
    </a>
  );
}
