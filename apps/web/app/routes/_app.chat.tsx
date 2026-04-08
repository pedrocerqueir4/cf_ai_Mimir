import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Send, Loader2, Check, CheckCircle } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";

import { useChatStore } from "~/stores/chat-store";
import { sendChatMessage, pollGenerationStatus } from "~/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant";

interface LocalMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  isTyping?: boolean;
  isGenerationProgress?: boolean;
  isGenerationComplete?: boolean;
  isGenerationFailed?: boolean;
  workflowRunId?: string;
  roadmapId?: string;
}

// ─── Generation Progress Bubble ───────────────────────────────────────────────

const GENERATION_STEPS = [
  "Analyzing topic...",
  "Building roadmap...",
  "Generating lessons...",
];

interface GenerationProgressProps {
  workflowRunId: string;
  onComplete: (roadmapId: string) => void;
  onFailed: () => void;
}

function GenerationProgressBubble({
  workflowRunId,
  onComplete,
  onFailed,
}: GenerationProgressProps) {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [completedRoadmapId, setCompletedRoadmapId] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onFailedRef = useRef(onFailed);
  onCompleteRef.current = onComplete;
  onFailedRef.current = onFailed;

  const { data: statusData } = useQuery({
    queryKey: ["generation-status", workflowRunId],
    queryFn: () => pollGenerationStatus(workflowRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "complete" || status === "failed") return false;
      return 3000;
    },
    enabled: !isComplete && !isFailed,
  });

  useEffect(() => {
    if (!statusData) return;

    if (statusData.status === "complete" && statusData.roadmapId) {
      setActiveStep(3);
      setIsComplete(true);
      setCompletedRoadmapId(statusData.roadmapId);
      onCompleteRef.current(statusData.roadmapId);
    } else if (statusData.status === "failed") {
      setIsFailed(true);
      onFailedRef.current();
    } else if (statusData.status === "generating") {
      const step = statusData.step ?? 1;
      setActiveStep(step - 1);
    }
  }, [statusData]);

  if (isFailed) {
    return (
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs text-muted-foreground">AI</AvatarFallback>
        </Avatar>
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-destructive bg-card p-4">
          <p className="text-sm text-destructive">
            Roadmap generation failed. Try describing your topic again or rephrase your request.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-xs text-muted-foreground">AI</AvatarFallback>
      </Avatar>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-card p-4">
        {!isComplete ? (
          <div aria-live="polite" className="flex flex-col gap-2">
            {GENERATION_STEPS.map((stepLabel, index) => {
              const isDone = index < activeStep;
              const isActive = index === activeStep;
              return (
                <div
                  key={index}
                  className={`flex items-center gap-2 transition-opacity duration-300 ${
                    index > activeStep ? "opacity-40" : "opacity-100"
                  }`}
                >
                  {isDone ? (
                    <Check
                      size={16}
                      className="shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : isActive ? (
                    <Loader2
                      size={16}
                      className="shrink-0 animate-spin text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <div className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-sm text-muted-foreground">{stepLabel}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="shrink-0 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium">Your roadmap is ready.</span>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => completedRoadmapId && navigate(`/roadmaps/${completedRoadmapId}`)}
            >
              View roadmap
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3" aria-label="AI is thinking">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-xs text-muted-foreground">AI</AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-sm bg-card p-4">
        <div className="flex gap-1">
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: LocalMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (message.isTyping) {
    return <TypingIndicator />;
  }

  if (message.isGenerationProgress && message.workflowRunId) {
    // Handled by GenerationProgressBubble — should not render here
    return null;
  }

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-foreground/8 p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
        <span className="text-xs text-muted-foreground">{formattedTime}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs text-muted-foreground">AI</AvatarFallback>
        </Avatar>
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-card p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
      <span className="ml-11 text-xs text-muted-foreground">{formattedTime}</span>
    </div>
  );
}

// ─── Main Chat Screen ─────────────────────────────────────────────────────────

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeGenerations, setActiveGenerations] = useState<
    Array<{ id: string; workflowRunId: string }>
  >([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationId = useRef<string>(
    typeof crypto !== "undefined"
      ? crypto.randomUUID()
      : `conv-${Date.now()}`
  );

  const { setConversationId, setStreaming: setStoreStreaming } = useChatStore();

  // Sync conversationId to store on mount
  useEffect(() => {
    setConversationId(conversationId.current);
  }, [setConversationId]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }, [input]);

  const handleGenerationComplete = useCallback(
    (generationId: string, roadmapId: string) => {
      setActiveGenerations((prev) => prev.filter((g) => g.id !== generationId));
    },
    []
  );

  const handleGenerationFailed = useCallback((generationId: string) => {
    setActiveGenerations((prev) => prev.filter((g) => g.id !== generationId));
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    // Add user message
    const userMsg: LocalMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Show typing indicator
    const typingId = crypto.randomUUID();
    const typingMsg: LocalMessage = {
      id: typingId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      isTyping: true,
    };
    setMessages((prev) => [...prev, typingMsg]);
    setIsStreaming(true);
    setStoreStreaming(true);

    try {
      const response = await sendChatMessage(trimmed, conversationId.current);
      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        // SSE streaming response — replace typing indicator with empty AI message
        const aiMsgId = crypto.randomUUID();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingId
              ? { id: aiMsgId, role: "assistant", content: "", createdAt: new Date().toISOString() }
              : m
          )
        );

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data) as { response?: string; text?: string };
                const token = parsed.response ?? parsed.text;
                if (token) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === aiMsgId
                        ? { ...m, content: m.content + token }
                        : m
                    )
                  );
                }
              } catch {
                // Non-JSON SSE data chunk — treat as raw text
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content: m.content + data }
                      : m
                  )
                );
              }
            }
          }
        }
      } else {
        // JSON response — check for generation_started
        const json = await response.json() as {
          type?: string;
          workflowRunId?: string;
        };

        if (json.type === "generation_started" && json.workflowRunId) {
          const generationId = crypto.randomUUID();
          // Remove typing indicator
          setMessages((prev) => prev.filter((m) => m.id !== typingId));
          // Add generation progress message
          const progressMsg: LocalMessage = {
            id: generationId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
            isGenerationProgress: true,
            workflowRunId: json.workflowRunId,
          };
          setMessages((prev) => [...prev, progressMsg]);
          setActiveGenerations((prev) => [
            ...prev,
            { id: generationId, workflowRunId: json.workflowRunId! },
          ]);
        } else {
          // Unexpected JSON response — show as AI text
          setMessages((prev) =>
            prev.map((m) =>
              m.id === typingId
                ? {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: "Couldn't get a response. Please try your message again.",
                    createdAt: new Date().toISOString(),
                  }
                : m
            )
          );
        }
      }
    } catch {
      // Error — replace typing indicator with error message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === typingId
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Couldn't get a response. Please try your message again.",
                createdAt: new Date().toISOString(),
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      setStoreStreaming(false);
    }
  }, [input, isStreaming, setStoreStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const isInputDisabled = isStreaming;
  const isSendDisabled = !input.trim() || isStreaming;

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-4 pb-24 lg:pb-6">
          {messages.length === 0 ? (
            /* Empty state */
            <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
              <div className="max-w-sm text-center">
                <h1 className="text-xl font-semibold leading-tight">
                  What do you want to learn?
                </h1>
                <p className="mt-3 text-base text-muted-foreground">
                  Describe any topic and I&apos;ll build a personalized learning roadmap for you.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) => {
                if (message.isGenerationProgress && message.workflowRunId) {
                  const generation = activeGenerations.find(
                    (g) => g.id === message.id
                  );
                  if (generation) {
                    return (
                      <GenerationProgressBubble
                        key={message.id}
                        workflowRunId={generation.workflowRunId}
                        onComplete={(roadmapId) =>
                          handleGenerationComplete(generation.id, roadmapId)
                        }
                        onFailed={() => handleGenerationFailed(generation.id)}
                      />
                    );
                  }
                }
                return <MessageBubble key={message.id} message={message} />;
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Fixed input bar — above bottom nav on mobile */}
      <div className="fixed bottom-16 left-0 right-0 z-40 border-t border-border bg-background px-4 py-3 lg:static lg:bottom-0 lg:border-t lg:px-4 lg:py-3">
        <div className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            rows={1}
            disabled={isInputDisabled}
            aria-label="Chat message input"
            className="min-h-12 flex-1 resize-none rounded-md border border-input bg-background px-3 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ maxHeight: "6rem", overflowY: "auto" }}
          />
          <Button
            type="button"
            variant="default"
            size="icon"
            onClick={() => void handleSend()}
            disabled={isSendDisabled}
            aria-label="Send message"
            className="h-12 w-12 shrink-0"
          >
            <Send size={20} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
