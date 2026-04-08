import { z } from "zod";

// ─── Roadmap Output Schema ────────────────────────────────────────────────────

export const RoadmapNodeSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  order: z.number().int().min(0),
  prerequisites: z.array(z.string()).default([]),
});

export const RoadmapOutputSchema = z.object({
  title: z.string().min(1).max(200),
  complexity: z.enum(["linear", "branching"]),
  nodes: z.array(RoadmapNodeSchema).min(3).max(20),
});

export type RoadmapNode = z.infer<typeof RoadmapNodeSchema>;
export type RoadmapOutput = z.infer<typeof RoadmapOutputSchema>;

// ─── Lesson Output Schema ─────────────────────────────────────────────────────

export const LessonOutputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(100).max(15000), // Markdown, 2-10 min read
});

export type LessonOutput = z.infer<typeof LessonOutputSchema>;

// ─── Quiz Output Schema ───────────────────────────────────────────────────────

export const QuizOptionSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(500),
});

export const QuizQuestionSchema = z.object({
  questionText: z.string().min(1).max(1000),
  questionType: z.enum(["mcq", "true_false"]),
  options: z.array(QuizOptionSchema).min(2).max(4),
  correctOptionId: z.string(),
  explanation: z.string().min(1).max(1000),
});

export const QuizOutputSchema = z.object({
  questions: z.array(QuizQuestionSchema).min(2).max(5),
});

export type QuizOption = z.infer<typeof QuizOptionSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizOutput = z.infer<typeof QuizOutputSchema>;
