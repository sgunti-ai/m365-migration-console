CREATE TABLE `discovery_assessments` (
	`id` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`connectionId` varchar(32) NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`tenantLabel` varchar(160) NOT NULL,
	`organizationName` varchar(255),
	`status` enum('completed','blocked','failed') NOT NULL,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp NOT NULL,
	`workloads` text NOT NULL,
	`permissionErrors` text NOT NULL,
	`permissionChecklist` text NOT NULL,
	`inventoryId` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discovery_assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discovery_inventory_runs` (
	`id` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`assessmentId` varchar(32) NOT NULL,
	`connectionId` varchar(32) NOT NULL,
	`status` enum('queued','running','completed','blocked','failed','unavailable') NOT NULL,
	`progress` int NOT NULL DEFAULT 0,
	`itemsTotal` int NOT NULL DEFAULT 0,
	`itemsDone` int NOT NULL DEFAULT 0,
	`totalSizeBytes` bigint NOT NULL DEFAULT 0,
	`workloadResults` text NOT NULL,
	`error` text,
	`startedAt` timestamp NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discovery_inventory_runs_id` PRIMARY KEY(`id`)
);
