-- Add currentStep column to roadmaps table for workflow progress tracking
-- Drives GenerationProgressBubble on /chat: 0=pending, 1=roadmap, 2=lessons, 3=quizzes, 4=embeddings (complete)
ALTER TABLE `roadmaps` ADD `current_step` integer DEFAULT 0 NOT NULL;
