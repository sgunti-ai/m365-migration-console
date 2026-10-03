CREATE TABLE `migration_runbook_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runbookId` varchar(32) NOT NULL,
	`sequence` int NOT NULL,
	`category` varchar(64) NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`ownerRole` varchar(96) NOT NULL,
	`status` enum('Pending','In progress','Completed','Blocked','Skipped') NOT NULL DEFAULT 'Pending',
	`requiresEvidence` tinyint NOT NULL DEFAULT 0,
	`evidence` text,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_runbook_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_runbooks` (
	`id` varchar(32) NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`targetWaveId` varchar(32),
	`name` varchar(160) NOT NULL,
	`status` enum('Draft','Ready','In progress','Completed','Blocked') NOT NULL DEFAULT 'Draft',
	`scheduledAt` timestamp,
	`changeFreezeAt` timestamp,
	`rollbackWindowMinutes` int NOT NULL DEFAULT 60,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_runbooks_id` PRIMARY KEY(`id`)
);
