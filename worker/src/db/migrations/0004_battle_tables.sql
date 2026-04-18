CREATE TABLE `battle_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`battle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`selected_option_id` text,
	`correct` integer DEFAULT false NOT NULL,
	`response_time_ms` integer NOT NULL,
	`points_awarded` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `battle_quiz_pool`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `battle_ledger` (
	`battle_id` text PRIMARY KEY NOT NULL,
	`winner_id` text,
	`loser_id` text,
	`xp_amount` integer NOT NULL,
	`outcome` text NOT NULL,
	`settled_at` integer NOT NULL,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`winner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`loser_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `battle_pool_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`status` text NOT NULL,
	`workflow_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `battle_quiz_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_topic_id` text NOT NULL,
	`question_text` text NOT NULL,
	`question_type` text NOT NULL,
	`options_json` text NOT NULL,
	`correct_option_id` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_topic_id`) REFERENCES `battle_pool_topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `battles` (
	`id` text PRIMARY KEY NOT NULL,
	`join_code` text NOT NULL,
	`host_id` text NOT NULL,
	`guest_id` text,
	`host_roadmap_id` text NOT NULL,
	`guest_roadmap_id` text,
	`winning_roadmap_id` text,
	`winning_topic` text,
	`pool_topic_id` text,
	`question_count` integer NOT NULL,
	`host_wager_tier` integer,
	`guest_wager_tier` integer,
	`applied_wager_tier` integer,
	`host_wager_amount` integer,
	`guest_wager_amount` integer,
	`wager_amount` integer,
	`status` text NOT NULL,
	`winner_id` text,
	`host_final_score` integer,
	`guest_final_score` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`winning_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pool_topic_id`) REFERENCES `battle_pool_topics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`winner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Partial UNIQUE INDEX on join_code, scoped to lobby state only.
-- Drizzle Kit does not emit partial indexes; hand-appended per 04-01-PLAN.md.
-- Completed/expired/forfeited battles can reuse codes; only open lobbies are unique.
CREATE UNIQUE INDEX `idx_battles_lobby_joincode` ON `battles` (`join_code`) WHERE `status` = 'lobby';
--> statement-breakpoint
CREATE INDEX `idx_battles_host_status` ON `battles` (`host_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_battles_guest_status` ON `battles` (`guest_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_battles_completed_at` ON `battles` (`completed_at`);
