CREATE TABLE `identity_mapping_policies` (
	`id` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`sourceConnectionId` varchar(32) NOT NULL,
	`targetConnectionId` varchar(32) NOT NULL,
	`sourceDomain` varchar(255) NOT NULL,
	`targetDomain` varchar(255) NOT NULL,
	`collisionMatrix` text NOT NULL,
	`status` enum('Draft','Proposed','Approved','Blocked') NOT NULL DEFAULT 'Draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `identity_mapping_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `identity_mappings` (
	`id` varchar(32) NOT NULL,
	`policyId` varchar(32) NOT NULL,
	`ownerOpenId` varchar(128) NOT NULL,
	`sourceUserId` varchar(255) NOT NULL,
	`sourceUpn` varchar(320),
	`sourceMail` varchar(320),
	`targetUserId` varchar(255),
	`targetUpn` varchar(320),
	`targetMail` varchar(320),
	`status` enum('proposed','approved','rejected','blocked','needs_review','unmapped') NOT NULL,
	`matchMethod` varchar(64) NOT NULL,
	`confidence` int NOT NULL DEFAULT 0,
	`collisionCode` varchar(96),
	`explanation` text NOT NULL,
	`decision` varchar(32) NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `identity_mappings_id` PRIMARY KEY(`id`)
);
