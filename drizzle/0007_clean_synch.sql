CREATE TABLE `discovery_inventory_resources` (
	`id` varchar(255) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`runId` varchar(32) NOT NULL,
	`assessmentId` varchar(32) NOT NULL,
	`workload` varchar(32) NOT NULL,
	`resourceId` varchar(512) NOT NULL,
	`displayName` varchar(255),
	`status` enum('discovered','permission_required','unavailable','failed') NOT NULL,
	`itemCount` int NOT NULL DEFAULT 0,
	`sizeBytes` bigint,
	`detail` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discovery_inventory_resources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discovery_inventory_settings` (
	`connectionId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`maxConcurrency` int NOT NULL DEFAULT 4,
	`requestsPerSecond` int NOT NULL DEFAULT 8,
	`maxRetries` int NOT NULL DEFAULT 4,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discovery_inventory_settings_connectionId` PRIMARY KEY(`connectionId`)
);
