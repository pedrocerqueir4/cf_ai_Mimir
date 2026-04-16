// Typed API client for all Phase 2 endpoints
// All requests use credentials: "include" for cookie-based auth

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  metadata?: {
    type?: "generation_started" | "generation_progress" | "generation_complete" | "text";
    workflowRunId?: string;
    roadmapId?: string;
  };
}

export interface RoadmapListItem {
  id: string;
  title: string;
  topic: string;
  complexity: string;
  status: string;
  totalLessons: number;
  completedLessons: number;
  createdAt: string;
}

export interface RoadmapNode {
  id: string;
  lessonId: string;
  title: string;
  description: string;
  order: number;
  parentId: string | null;
  state: "locked" | "available" | "in_progress" | "completed";
  children: RoadmapNode[];
}

export interface RoadmapDetail {
  id: string;
  userId: string;
  title: string;
  topic: string;
  complexity: string;
  status: string;
  workflowRunId: string | null;
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  type: "mcq" | "true_false";
  question: string;
  options: QuizOption[];
  order: number;
  // correctOptionId intentionally omitted — never sent before answer submission
}

export interface QuizAnswerResult {
  correct: boolean;
  correctOptionId: string;
  explanation: string;
  xpEarned: number;
}

// ─── Gamification Types ──────────────────────────────────────────────────────

export interface LessonCompleteResult {
  completed: boolean;
  xpEarned: number;
  streakBonus: number;
  newXp: number;
  newLevel: number;
  levelUp: boolean;
}

export interface UserStats {
  xp: number;
  level: number;
  xpToNextLevel: number;
  progressPercent: number;
  streak: number;
  longestStreak: number;
  lastActiveRoadmapId: string | null;
  todayLessonCompleted: boolean;
  lessonsCompleted: number;
  questionsCorrect: number;
  name: string;
  email: string;
  image: string | null;
}

export interface LessonDetail {
  id: string;
  roadmapId: string;
  nodeId: string;
  title: string;
  content: string;
  order: number;
  createdAt: string;
  isCompleted: boolean;
  questions: QuizQuestion[];
}

export interface QAResponse {
  answer: string;
  citations: Array<{
    lessonId: string;
    lessonTitle: string;
    lessonOrder: number;
  }>;
}

export interface GenerationStatus {
  status: "pending" | "generating" | "complete" | "failed";
  roadmapId?: string;
  step?: 1 | 2 | 3;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message. Returns a Response for SSE streaming, or resolves
 * immediately with { type: "generation_started", workflowRunId } JSON for
 * roadmap generation requests.
 */
export async function sendChatMessage(
  message: string,
  conversationId: string
): Promise<Response> {
  const response = await fetch("/api/chat/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ message, conversationId }),
  });

  if (!response.ok) {
    throw new Error(`Chat message failed: ${response.status}`);
  }

  return response;
}

/**
 * Fetch all messages in a conversation.
 */
export async function fetchConversationMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const response = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`);
  }

  return response.json() as Promise<ChatMessage[]>;
}

/**
 * Poll workflow generation status.
 */
export async function pollGenerationStatus(
  workflowRunId: string
): Promise<GenerationStatus> {
  const response = await fetch(
    `/api/chat/status/${encodeURIComponent(workflowRunId)}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to poll generation status: ${response.status}`);
  }

  return response.json() as Promise<GenerationStatus>;
}

// ─── Roadmaps ─────────────────────────────────────────────────────────────────

/**
 * Fetch all roadmaps for the current user.
 */
export async function fetchRoadmaps(): Promise<RoadmapListItem[]> {
  const response = await fetch("/api/roadmaps", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch roadmaps: ${response.status}`);
  }

  return response.json() as Promise<RoadmapListItem[]>;
}

/**
 * Fetch a single roadmap with full node tree.
 */
export async function fetchRoadmapDetail(id: string): Promise<RoadmapDetail> {
  const response = await fetch(
    `/api/roadmaps/${encodeURIComponent(id)}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch roadmap: ${response.status}`);
  }

  return response.json() as Promise<RoadmapDetail>;
}

/**
 * Fetch a specific lesson within a roadmap.
 */
export async function fetchLesson(
  roadmapId: string,
  lessonId: string
): Promise<LessonDetail> {
  const response = await fetch(
    `/api/roadmaps/${encodeURIComponent(roadmapId)}/lessons/${encodeURIComponent(lessonId)}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch lesson: ${response.status}`);
  }

  return response.json() as Promise<LessonDetail>;
}

/**
 * Submit an answer to a quiz question. Returns correctness and explanation.
 */
export async function submitQuizAnswer(
  questionId: string,
  selectedOptionId: string
): Promise<QuizAnswerResult> {
  const response = await fetch(`/api/roadmaps/quiz/${encodeURIComponent(questionId)}/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ selectedOptionId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit quiz answer: ${response.status}`);
  }

  return response.json() as Promise<QuizAnswerResult>;
}

/**
 * Mark a lesson as complete and record XP. Returns gamification result including
 * XP earned, streak bonus, new level, and whether a level-up occurred.
 */
export async function completeLesson(
  roadmapId: string,
  lessonId: string,
  timezone?: string
): Promise<LessonCompleteResult> {
  const headers: Record<string, string> = {};
  if (timezone) headers["X-User-Timezone"] = timezone;

  const response = await fetch(
    `/api/roadmaps/${encodeURIComponent(roadmapId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
    {
      method: "POST",
      credentials: "include",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to complete lesson: ${response.status}`);
  }

  return response.json() as Promise<LessonCompleteResult>;
}

/**
 * Fetch practice quiz questions for a roadmap (questions from completed lessons).
 */
export async function fetchPracticeQuiz(
  roadmapId: string
): Promise<QuizQuestion[]> {
  const response = await fetch(
    `/api/roadmaps/${encodeURIComponent(roadmapId)}/quiz/practice`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch practice quiz: ${response.status}`);
  }

  return response.json() as Promise<QuizQuestion[]>;
}

// ─── Q&A ──────────────────────────────────────────────────────────────────────

/**
 * Ask an AI question scoped to a roadmap (and optionally a specific lesson).
 * Uses Vectorize-backed RAG for contextual answers with lesson citations.
 */
export async function askQuestion(
  question: string,
  roadmapId: string,
  lessonId?: string
): Promise<QAResponse> {
  const response = await fetch("/api/qa/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ question, roadmapId, lessonId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ask question: ${response.status}`);
  }

  return response.json() as Promise<QAResponse>;
}

// ─── Gamification ────────────────────────────────────────────────────────────

/**
 * Fetch current user's gamification stats (XP, level, streak, profile info).
 */
export async function fetchUserStats(tz: string): Promise<UserStats> {
  const response = await fetch(`/api/user/stats?tz=${encodeURIComponent(tz)}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user stats: ${response.status}`);
  }

  return response.json() as Promise<UserStats>;
}
