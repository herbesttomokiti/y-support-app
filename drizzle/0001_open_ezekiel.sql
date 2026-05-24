CREATE TABLE `step_completions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`taskId` int NOT NULL,
	`stepOrder` int NOT NULL,
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	`memoImageKey` varchar(512),
	`memoImageUrl` varchar(1024),
	`memoText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `step_completions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`actualMinutes` int,
	`panicButtonCount` int NOT NULL DEFAULT 0,
	`currentStepOrder` int NOT NULL DEFAULT 0,
	`reportText` text,
	`sheetExported` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `task_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`clientName` varchar(255),
	`description` text NOT NULL,
	`estimatedMinutes` int DEFAULT 30,
	`steps` json NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `task_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`templateId` int,
	`assignedTo` int NOT NULL,
	`createdBy` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`clientName` varchar(255),
	`description` text,
	`estimatedMinutes` int DEFAULT 30,
	`steps` json NOT NULL,
	`status` enum('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
	`scheduledDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
