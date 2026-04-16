-- Create user_stats table for gamification XP, streaks, and progress tracking (Phase 3, Plan 01)
CREATE TABLE `user_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`lessons_completed` integer DEFAULT 0 NOT NULL,
	`questions_correct` integer DEFAULT 0 NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_streak_date` text,
	`last_active_roadmap_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_active_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE set null
);
