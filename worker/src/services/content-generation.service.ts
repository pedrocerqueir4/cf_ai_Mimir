// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * System prompt for the Mimir buddy chat (conversational learning companion).
 * Used in buildChatMessages() — NOT for roadmap/lesson/quiz generation.
 * Those use dedicated prompts from roadmap-prompts.ts.
 */
const BUDDY_SYSTEM_PROMPT =
  "You are Mimir, a friendly and encouraging learning companion. You help users explore topics, answer questions about learning, and suggest when a learning roadmap might be helpful. Keep responses concise and conversational. When a user wants to learn a specific topic in depth, suggest creating a roadmap.";

/** Maximum chat history messages passed to Workers AI (keeps within 24k token limit). */
const MAX_HISTORY_MESSAGES = 20;

// ─── Roadmap intent patterns ──────────────────────────────────────────────────

const ROADMAP_INTENT_PATTERNS: RegExp[] = [
  /create\s+a\s+roadmap/i,
  /make\s+a\s+roadmap/i,
  /build\s+a\s+roadmap/i,
  /generate\s+a\s+roadmap/i,
  /teach\s+me\s+about/i,
  /i\s+want\s+to\s+learn/i,
  /help\s+me\s+learn/i,
  /create\s+a\s+learning\s+path/i,
  /learning\s+plan\s+for/i,
];

// ─── Intent detection prefix strippers ───────────────────────────────────────

const TOPIC_PREFIX_PATTERNS: Array<RegExp> = [
  /^create\s+a\s+roadmap\s+(for\s+)?/i,
  /^make\s+a\s+roadmap\s+(for\s+)?/i,
  /^build\s+a\s+roadmap\s+(for\s+)?/i,
  /^generate\s+a\s+roadmap\s+(for\s+)?/i,
  /^teach\s+me\s+about\s+/i,
  /^i\s+want\s+to\s+learn\s+(about\s+)?/i,
  /^help\s+me\s+learn\s+(about\s+)?/i,
  /^create\s+a\s+learning\s+path\s+(for\s+)?/i,
  /^learning\s+plan\s+for\s+/i,
];

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Detects whether a user message is requesting roadmap/learning path creation.
 *
 * Keyword heuristic for MVP — intentionally simple. The chat API adds a
 * confirmation step before triggering the Workflow (Research Pitfall 4 pattern).
 *
 * @param message - Raw user message text.
 * @returns `true` if the message matches a roadmap creation intent pattern.
 */
export function detectRoadmapIntent(message: string): boolean {
  return ROADMAP_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Builds the messages array for Workers AI chat completion.
 *
 * Limits history to the last 20 messages to stay safely within Llama 3.3's
 * 24,576-token context window. Prepends the Mimir buddy system prompt.
 *
 * @param history - Prior conversation messages from D1 (user/assistant only).
 * @param newMessage - The new user message being submitted.
 * @returns Workers AI-formatted message array ready for `env.AI.run()`.
 */
export function buildChatMessages(history: ChatMessage[], newMessage: string): AiMessage[] {
  // Take the most recent 20 messages (avoids context overflow)
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

  return [
    { role: "system", content: BUDDY_SYSTEM_PROMPT },
    ...recentHistory,
    { role: "user", content: newMessage },
  ];
}

/**
 * Extracts the learning topic from a roadmap intent message by stripping
 * common intent prefixes.
 *
 * Examples:
 *   "create a roadmap for TypeScript" → "TypeScript"
 *   "teach me about machine learning" → "machine learning"
 *   "I want to learn React hooks"     → "React hooks"
 *
 * Used when triggering ContentGenerationWorkflow to pass a clean topic string,
 * not the raw user message.
 *
 * @param message - User message that passed `detectRoadmapIntent()`.
 * @returns Cleaned topic string (original message if no prefix matched).
 */
export function extractTopicFromMessage(message: string): string {
  const trimmed = message.trim();

  for (const pattern of TOPIC_PREFIX_PATTERNS) {
    if (pattern.test(trimmed)) {
      const extracted = trimmed.replace(pattern, "").trim();
      // Return original if stripping leaves nothing meaningful
      if (extracted.length > 0) {
        return extracted;
      }
    }
  }

  return trimmed;
}
