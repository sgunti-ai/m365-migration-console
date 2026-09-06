CREATE TABLE `migration_job_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(32) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `migration_job_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_jobs` (
	`id` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`workload` varchar(32) NOT NULL,
	`scope` varchar(255) NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`status` enum('Queued','Running','Paused','Completed','Needs review','Failed','Cancelled') NOT NULL DEFAULT 'Queued',
	`progress` int NOT NULL DEFAULT 0,
	`itemsDone` int NOT NULL DEFAULT 0,
	`itemsTotal` int NOT NULL DEFAULT 0,
	`throughputGbHr` int NOT NULL DEFAULT 0,
	`eta` varchar(64) NOT NULL DEFAULT 'Queued',
	`concurrency` varchar(32) NOT NULL DEFAULT 'Balanced',
	`batchMode` tinyint NOT NULL DEFAULT 0,
	`batchSize` varchar(64),
	`schedule` varchar(64),
	`scheduledAt` timestamp,
	`checkpoint` text,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
