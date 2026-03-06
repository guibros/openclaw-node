CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`task_id` text,
	`description` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`category` text,
	`file_path` text NOT NULL,
	`title` text,
	`date` text,
	`frontmatter` text,
	`content` text NOT NULL,
	`modified_at` text,
	`indexed_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_docs_file_path_unique` ON `memory_docs` (`file_path`);--> statement-breakpoint
CREATE TABLE `soul_evolution_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`soul_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`description` text NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`commit_hash` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `soul_evolution_log_event_id_unique` ON `soul_evolution_log` (`event_id`);--> statement-breakpoint
CREATE TABLE `soul_handoffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`from_soul` text NOT NULL,
	`to_soul` text NOT NULL,
	`reason` text,
	`context_path` text,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`kanban_column` text NOT NULL,
	`owner` text,
	`soul_id` text,
	`handoff_source` text,
	`handoff_reason` text,
	`success_criteria` text,
	`artifacts` text,
	`next_action` text,
	`updated_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sort_order` integer DEFAULT 0
);
