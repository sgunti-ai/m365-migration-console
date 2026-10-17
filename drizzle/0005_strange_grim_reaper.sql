CREATE TABLE `migration_job_validations` (
	`id` varchar(32) NOT NULL,
	`jobId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`workload` varchar(32) NOT NULL,
	`status` enum('Running','Passed','Needs review','Blocked') NOT NULL DEFAULT 'Running',
	`score` int NOT NULL DEFAULT 0,
	`checks` text NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `migration_job_validations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_remediation_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`workload` varchar(32) NOT NULL,
	`code` varchar(96) NOT NULL,
	`entity` varchar(255) NOT NULL,
	`severity` enum('Critical','High','Medium','Low') NOT NULL,
	`status` enum('Open','In progress','Resolved','Waived') NOT NULL DEFAULT 'Open',
	`retryable` tinyint NOT NULL DEFAULT 0,
	`recommendation` text NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`nextRetryAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_remediation_items_id` PRIMARY KEY(`id`)
);
