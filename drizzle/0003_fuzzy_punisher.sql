CREATE TABLE `migration_projects` (
	`id` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`sourceConnectionId` varchar(32),
	`targetConnectionId` varchar(32),
	`phase` enum('Assessment','Mapping','Planning','Pilot','Migration','Validation','Cutover','Completed') NOT NULL DEFAULT 'Assessment',
	`status` enum('Draft','Active','Paused','Completed','Archived') NOT NULL DEFAULT 'Draft',
	`readinessScore` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_wave_dependencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`waveId` varchar(32) NOT NULL,
	`dependsOnWaveId` varchar(32) NOT NULL,
	`dependencyType` enum('Completion','Approval','Mapping') NOT NULL DEFAULT 'Completion',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `migration_wave_dependencies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_wave_populations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`waveId` varchar(32) NOT NULL,
	`sourceDriveId` varchar(255),
	`rootItemId` varchar(255),
	`sourceUserId` varchar(255),
	`targetUserId` varchar(255),
	`sourcePath` varchar(1024),
	`targetPath` varchar(1024),
	`itemCount` int NOT NULL DEFAULT 0,
	`status` enum('Pending','Scanned','Ready','Migrated','Needs review') NOT NULL DEFAULT 'Pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_wave_populations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migration_waves` (
	`id` varchar(32) NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`name` varchar(160) NOT NULL,
	`sequence` int NOT NULL DEFAULT 1,
	`phase` enum('Assessment','Mapping','Planning','Pilot','Migration','Validation','Cutover','Completed') NOT NULL DEFAULT 'Planning',
	`status` enum('Planned','Ready','Running','Paused','Completed','Needs review','Blocked') NOT NULL DEFAULT 'Planned',
	`runMode` enum('Full','Incremental','Cutover') NOT NULL DEFAULT 'Full',
	`itemsTotal` int NOT NULL DEFAULT 0,
	`itemsDone` int NOT NULL DEFAULT 0,
	`progress` int NOT NULL DEFAULT 0,
	`concurrency` varchar(32) NOT NULL DEFAULT 'Balanced',
	`validationPolicy` varchar(64) NOT NULL DEFAULT 'Standard',
	`approvalState` enum('Not required','Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
	`scheduledAt` timestamp,
	`changeFreezeAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `migration_waves_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `migration_jobs` ADD `projectId` varchar(32);--> statement-breakpoint
ALTER TABLE `migration_jobs` ADD `waveId` varchar(32);--> statement-breakpoint
ALTER TABLE `migration_jobs` ADD `phase` enum('Assessment','Mapping','Planning','Pilot','Migration','Validation','Cutover','Completed') DEFAULT 'Migration' NOT NULL;