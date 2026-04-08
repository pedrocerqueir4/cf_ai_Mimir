// ─── AI Prompt Builders for Cloudflare Workflow Steps ────────────────────────
// These builders produce system prompts and JSON schemas for Workers AI
// (Llama 3.3-70b-instruct-fp8-fast) structured output generation.

// ─── Roadmap Generation ───────────────────────────────────────────────────────

/**
 * System prompt for roadmap structure generation (Workflow Step 1).
 * Instructs the model to classify topic complexity and generate lesson nodes.
 */
export function buildRoadmapSystemPrompt(): string {
  return `You are an expert curriculum designer who creates structured learning roadmaps.

Your task is to analyze the given topic and generate a structured learning roadmap as JSON.

Instructions:
- Classify the topic complexity as "linear" (step-by-step sequential, one clear path) or "branching" (multiple paths with prerequisites for complex topics with diverging skill trees).
- Generate 5-15 lesson nodes that comprehensively cover the topic.
- Each node must have a unique string id (e.g. "node-1", "node-2"), a concise title (max 200 chars), an optional short description (max 500 chars), a zero-based integer order, and a prerequisites array (empty [] for root nodes, or list prerequisite node ids for branching topics).
- For linear topics: all nodes have empty prerequisites arrays and sequential order (0, 1, 2...).
- For branching topics: prerequisite node ids create the skill-tree structure.
- Keep lesson titles specific and actionable — not generic (avoid "Introduction", "Overview").

Respond ONLY with valid JSON matching the provided schema. No prose, no markdown fences.`;
}

/**
 * JSON schema for roadmap generation — passed as response_format.json_schema to Workers AI.
 */
export const ROADMAP_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The roadmap title, concise and topic-specific",
    },
    complexity: {
      type: "string",
      enum: ["linear", "branching"],
      description: "Topic complexity classification",
    },
    nodes: {
      type: "array",
      minItems: 3,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          order: { type: "integer", minimum: 0 },
          prerequisites: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "title", "order", "prerequisites"],
      },
    },
  },
  required: ["title", "complexity", "nodes"],
};

// ─── Lesson Generation ────────────────────────────────────────────────────────

/**
 * System prompt for per-node lesson content generation (Workflow Step 2).
 */
export function buildLessonSystemPrompt(
  topicTitle: string,
  nodeTitle: string,
  nodeDescription: string,
): string {
  return `You are an expert educator creating bite-sized lesson content for a learning platform.

Topic: "${topicTitle}"
Lesson Node: "${nodeTitle}"
${nodeDescription ? `Node description: "${nodeDescription}"` : ""}

Your task is to write a complete lesson for this node.

Instructions:
- Write a bite-sized lesson (500-2000 words) focused on a single concept.
- Use Markdown with headers (##, ###), bullet points, numbered lists, and code examples where appropriate.
- The lesson should take 2-10 minutes to read.
- Be clear, concrete, and use practical examples.
- Assume the learner has completed prerequisite nodes in this roadmap.
- Do NOT cover concepts from other nodes — stay focused on this single node's topic.

Respond ONLY with valid JSON matching the provided schema. No prose, no markdown fences.`;
}

/**
 * JSON schema for lesson generation — passed as response_format.json_schema to Workers AI.
 */
export const LESSON_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The lesson title, specific to this node's content",
    },
    content: {
      type: "string",
      description: "Full lesson content in Markdown format (500-2000 words)",
    },
  },
  required: ["title", "content"],
};

// ─── Quiz Generation ──────────────────────────────────────────────────────────

/**
 * System prompt for per-lesson quiz generation (Workflow Step 3).
 * @param lessonContent - The Markdown lesson content to generate questions from.
 */
export function buildQuizSystemPrompt(lessonContent: string): string {
  return `You are an expert quiz designer creating comprehension questions for a learning platform.

Lesson content:
---
${lessonContent}
---

Your task is to generate 2-5 comprehension quiz questions about this lesson content.

Instructions:
- Use multiple choice (4 options, questionType: "mcq") or true/false (2 options, questionType: "true_false") format.
- For MCQ: provide exactly 4 options with unique string ids (e.g. "opt-a", "opt-b", "opt-c", "opt-d").
- For true/false: provide exactly 2 options with ids "opt-true" and "opt-false".
- Include one correct answer id (correctOptionId) per question.
- Include a clear explanation of why the correct answer is correct.
- Questions should test understanding, not just recall of exact wording.
- Vary question types — do not make all questions the same type.
- NEVER expose the correctOptionId in option text or elsewhere — it is server-side only.

Respond ONLY with valid JSON matching the provided schema. No prose, no markdown fences.`;
}

/**
 * JSON schema for quiz generation — passed as response_format.json_schema to Workers AI.
 */
export const QUIZ_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          questionText: {
            type: "string",
            description: "The question text",
          },
          questionType: {
            type: "string",
            enum: ["mcq", "true_false"],
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
              },
              required: ["id", "text"],
            },
          },
          correctOptionId: {
            type: "string",
            description: "The id of the correct option",
          },
          explanation: {
            type: "string",
            description: "Explanation of why the correct answer is correct",
          },
        },
        required: ["questionText", "questionType", "options", "correctOptionId", "explanation"],
      },
    },
  },
  required: ["questions"],
};
