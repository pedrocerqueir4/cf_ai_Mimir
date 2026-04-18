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

// ─── Battle Types ────────────────────────────────────────────────────────────

export type BattleStatus =
  | "lobby"
  | "pre-battle"
  | "active"
  | "completed"
  | "forfeited"
  | "expired";

export type PoolStatus = "generating" | "ready" | "failed";

export interface BattleCreateResponse {
  battleId: string;
  joinCode: string;
  questionCount: 5 | 10 | 15;
  hostId: string;
  expiresAt: number;
}

export interface BattleJoinResponseReady {
  status: "ready";
  battleId: string;
  winningRoadmapId: string;
  winningTopic: string;
  poolTopicId: string;
}

export interface BattleJoinResponseGenerating {
  status: "generating";
  battleId: string;
  winningRoadmapId: string;
  winningTopic: string;
  poolTopicId: string;
  workflowRunId: string;
}

export type BattleJoinResponse =
  | BattleJoinResponseReady
  | BattleJoinResponseGenerating;

export interface BattleLobbyState {
  battleId: string;
  joinCode: string;
  status: BattleStatus;
  hostId: string;
  hostName: string;
  hostRoadmapTitle: string;
  hostWagerTier: 10 | 15 | 20 | null;
  guestId: string | null;
  guestName: string | null;
  guestRoadmapTitle: string | null;
  guestWagerTier: 10 | 15 | 20 | null;
  /** Server's coin-flip-applied tier once BOTH players have proposed. Null until then. */
  appliedWagerTier: 10 | 15 | 20 | null;
  questionCount: 5 | 10 | 15;
  winningRoadmapId: string | null;
  winningTopic: string | null;
  poolStatus: PoolStatus | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface SubmitWagerResponse {
  tier: 10 | 15 | 20;
  xpAtProposal: number;
  bothProposed: boolean;
  appliedTier: 10 | 15 | 20 | null;
  hostWagerAmount: number | null;
  guestWagerAmount: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  image: string | null;
  netXp: number;
  wins: number;
  losses: number;
}

export interface LeaderboardResponse {
  window: "week" | "all";
  entries: LeaderboardEntry[];
}

/**
 * BattleApiError carries a status code plus the server-sent error message
 * (if any) so callers can map server errors to copy in UI-SPEC.
 */
export class BattleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly serverMessage: string | null,
    message: string,
  ) {
    super(message);
    this.name = "BattleApiError";
  }
}

async function readServerError(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? null;
  } catch {
    return null;
  }
}

// ─── Battle Fetchers ─────────────────────────────────────────────────────────

/**
 * Create a new battle as host.
 */
export async function createBattle(body: {
  roadmapId: string;
  questionCount: 5 | 10 | 15;
}): Promise<BattleCreateResponse> {
  const response = await fetch("/api/battle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to create battle: ${response.status}`,
    );
  }

  return response.json() as Promise<BattleCreateResponse>;
}

/**
 * Join an existing battle as guest via 6-char join code.
 * Server returns 200 (pool hit) or 202 (pool generating). Both carry the
 * BattleJoinResponse union — status field discriminates.
 */
export async function joinBattle(body: {
  joinCode: string;
  roadmapId?: string;
  presetTopic?: string;
}): Promise<BattleJoinResponse> {
  const response = await fetch("/api/battle/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  // 200 and 202 both carry the union; anything else is an error.
  if (!response.ok && response.status !== 202) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to join battle: ${response.status}`,
    );
  }

  return response.json() as Promise<BattleJoinResponse>;
}

/**
 * Fetch current battle lobby state. Used by the host's lobby poll loop
 * and the join flow's pre-battle gate.
 */
export async function fetchBattleLobby(
  battleId: string,
): Promise<BattleLobbyState> {
  const response = await fetch(
    `/api/battle/${encodeURIComponent(battleId)}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to fetch battle lobby: ${response.status}`,
    );
  }

  return response.json() as Promise<BattleLobbyState>;
}

/**
 * Propose a wager tier. Once BOTH participants propose, the server
 * randomly selects one tier and returns { bothProposed: true, appliedTier, … }.
 */
export async function submitWager(
  battleId: string,
  tier: 10 | 15 | 20,
): Promise<SubmitWagerResponse> {
  const response = await fetch(
    `/api/battle/${encodeURIComponent(battleId)}/wager`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tier }),
    },
  );

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to submit wager: ${response.status}`,
    );
  }

  return response.json() as Promise<SubmitWagerResponse>;
}

/**
 * Host-only: transition battle from pre-battle to active (after both wagers
 * have landed and the pre-battle reveals have played client-side).
 */
export async function startBattle(
  battleId: string,
): Promise<{ ok: true }> {
  const response = await fetch(
    `/api/battle/${encodeURIComponent(battleId)}/start`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to start battle: ${response.status}`,
    );
  }

  return response.json() as Promise<{ ok: true }>;
}

/**
 * Host-only: cancel a lobby before the guest joins. Transitions the battle
 * to 'expired' status; no wager transfer (no wager committed yet).
 */
export async function cancelBattle(
  battleId: string,
): Promise<{ ok: true }> {
  const response = await fetch(
    `/api/battle/${encodeURIComponent(battleId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to cancel battle: ${response.status}`,
    );
  }

  return response.json() as Promise<{ ok: true }>;
}

/**
 * Fetch top 50 leaderboard entries for the chosen time window (D-22, D-23).
 */
export async function fetchLeaderboard(
  window: "week" | "all",
): Promise<LeaderboardResponse> {
  const response = await fetch(
    `/api/battle/leaderboard?window=${encodeURIComponent(window)}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const msg = await readServerError(response);
    throw new BattleApiError(
      response.status,
      msg,
      `Failed to fetch leaderboard: ${response.status}`,
    );
  }

  return response.json() as Promise<LeaderboardResponse>;
}

/**
 * Build the WebSocket URL for a battle. Plan 07 consumes this from the
 * useBattleSocket hook. Lives here so route files can feed it into the hook
 * without importing WebSocket lifecycle code into the lib layer.
 */
export function buildBattleSocketUrl(battleId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/battle/${encodeURIComponent(battleId)}/ws`;
}
