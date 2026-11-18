ALTER TABLE `identity_mappings` ADD `readinessStatus` enum('unknown','checking','ready','needs_license','blocked','missing') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_mappings` ADD `readinessDetail` text;--> statement-breakpoint
ALTER TABLE `identity_mappings` ADD `requiredLicense` varchar(160);--> statement-breakpoint
ALTER TABLE `identity_mappings` ADD `assignedLicenseCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `identity_mappings` ADD `readinessCheckedAt` timestamp;--> statement-breakpoint
ALTER TABLE `identity_mappings` ADD `provisioningStatus` enum('not_requested','requested','created','failed') DEFAULT 'not_requested' NOT NULL;