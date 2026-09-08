CREATE TABLE `local_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`email` varchar(320),
	`displayName` varchar(160) NOT NULL,
	`passwordHash` text NOT NULL,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`mustChangePassword` tinyint NOT NULL DEFAULT 1,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_accounts_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `local_sessions` (
	`id` varchar(128) NOT NULL,
	`accountId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`ipAddress` varchar(64),
	`userAgent` varchar(512),
	CONSTRAINT `local_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_connections` (
	`id` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`label` varchar(160) NOT NULL,
	`direction` enum('source','target') NOT NULL,
	`tenantId` varchar(128) NOT NULL,
	`clientId` varchar(128),
	`siteUrl` varchar(512),
	`status` enum('Draft','Connected','Error') NOT NULL DEFAULT 'Draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `migration_jobs` MODIFY COLUMN `ownerOpenId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;