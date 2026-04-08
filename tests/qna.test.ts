import { describe, it, beforeAll } from "vitest";
import { setupD1 } from "./setup";

describe("QNA-01: In-lesson Q&A with RAG-backed answers", () => {
  beforeAll(async () => { await setupD1(); });

  it.todo("POST /api/qa/ask with lessonId scopes Vectorize query to that lesson");
  it.todo("Q&A response includes answer text derived from lesson content");
  it.todo("Q&A response includes sources array with lessonId and title");
});

describe("QNA-02: Standalone roadmap-level Q&A", () => {
  it.todo("POST /api/qa/ask without lessonId scopes to entire roadmap");
  it.todo("Q&A can answer questions spanning multiple lessons in the roadmap");
});

describe("QNA-03: AI answers scoped to user's own content", () => {
  it.todo("POST /api/qa/ask requires authenticated session");
  it.todo("Vectorize query includes userId metadata filter");
  it.todo("User A cannot access User B's roadmap content via Q&A");
});

describe("QNA-04: Q&A responses cite source lessons", () => {
  it.todo("Response sources array contains lessonId, title, and displayText");
  it.todo("Citation format matches [Lesson N: Title] pattern in answer text");
  it.todo("Citation lessonId references an actual lesson in the user's roadmap");
});
