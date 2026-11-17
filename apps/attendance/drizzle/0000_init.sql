CREATE TABLE `attendance_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`seq` integer NOT NULL,
	`member_id` text NOT NULL,
	`site_id` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`effective_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`credential_id` text,
	`ticket_id` text,
	`corrects_seq` integer,
	`reason` text,
	`actor_member_id` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`ip` text,
	`ua` text,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_events_kind_chk" CHECK(kind IN ('IN', 'OUT', 'VOID')),
	CONSTRAINT "attendance_events_source_chk" CHECK(source IN ('PUNCH', 'ADMIN')),
	CONSTRAINT "attendance_events_seq_chk" CHECK("attendance_events"."seq" >= 1),
	CONSTRAINT "attendance_events_void_chk" CHECK("attendance_events"."kind" <> 'VOID' OR "attendance_events"."corrects_seq" IS NOT NULL),
	CONSTRAINT "attendance_events_admin_chk" CHECK("attendance_events"."source" <> 'ADMIN' OR ("attendance_events"."reason" IS NOT NULL AND "attendance_events"."actor_member_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_events_org_seq_uq` ON `attendance_events` (`org_id`,`seq`);--> statement-breakpoint
CREATE INDEX `attendance_events_member_idx` ON `attendance_events` (`member_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`actor_member_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`ip` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_org_at_idx` ON `audit_log` (`org_id`,`at`);--> statement-breakpoint
CREATE TABLE `chain_heads` (
	`org_id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`aaguid` text,
	`device_type` text,
	`backup_eligible` integer NOT NULL,
	`backup_state` integer NOT NULL,
	`attachment` text,
	`reg_ip` text,
	`reg_ua` text,
	`reg_site_id` text,
	`reg_ticket_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reg_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credentials_status_chk" CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
	CONSTRAINT "credentials_counter_chk" CHECK("credentials"."counter" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_uq` ON `credentials` (`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_one_approved_uq` ON `credentials` (`member_id`) WHERE status = 'APPROVED';--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_one_pending_uq` ON `credentials` (`member_id`) WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX `credentials_member_idx` ON `credentials` (`member_id`);--> statement-breakpoint
CREATE TABLE `kiosks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text,
	`pairing_code_hash` text,
	`pairing_expires_at` integer,
	`status` text DEFAULT 'PAIRING' NOT NULL,
	`last_seen_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kiosks_status_chk" CHECK(status IN ('PAIRING', 'ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosks_token_hash_uq` ON `kiosks` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `kiosks_pairing_code_hash_uq` ON `kiosks` (`pairing_code_hash`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`employee_code` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'INVITED' NOT NULL,
	`google_sub` text,
	`webauthn_user_id` text NOT NULL,
	`full_name` text,
	`phone` text,
	`profile_completed_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_email_lower_chk" CHECK("members"."email" = lower("members"."email")),
	CONSTRAINT "members_role_chk" CHECK(role IN ('owner', 'admin', 'employee')),
	CONSTRAINT "members_status_chk" CHECK(status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_uq` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_google_sub_uq` ON `members` (`google_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_webauthn_user_id_uq` ON `members` (`webauthn_user_id`);--> statement-breakpoint
CREATE INDEX `members_org_idx` ON `members` (`org_id`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`allowed_google_hd` text,
	`allow_synced_passkeys` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `scan_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`qr_window` integer,
	`static_qr_id` text,
	`ip` text,
	`ua` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`bound_member_id` text,
	`used_at` integer,
	`event_id` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bound_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scan_tickets_source_chk" CHECK(source IN ('rotating', 'static'))
);
--> statement-breakpoint
CREATE INDEX `scan_tickets_site_idx` ON `scan_tickets` (`site_id`);--> statement-breakpoint
CREATE TABLE `site_networks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`cidr` text NOT NULL,
	`label` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_networks_site_cidr_uq` ON `site_networks` (`site_id`,`cidr`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`qr_mode` text DEFAULT 'rotating' NOT NULL,
	`rotation_seconds` integer DEFAULT 30 NOT NULL,
	`grace_windows` integer DEFAULT 1 NOT NULL,
	`qr_key_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_qr_mode_chk" CHECK(qr_mode IN ('rotating', 'static')),
	CONSTRAINT "sites_status_chk" CHECK(status IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "sites_rotation_chk" CHECK("sites"."rotation_seconds" > 0),
	CONSTRAINT "sites_grace_chk" CHECK("sites"."grace_windows" >= 0),
	CONSTRAINT "sites_key_version_chk" CHECK("sites"."qr_key_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `sites_org_idx` ON `sites` (`org_id`);--> statement-breakpoint
CREATE TABLE `static_qr_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`label` text,
	`issued_by` text,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "static_qr_codes_status_chk" CHECK(status IN ('ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
CREATE INDEX `static_qr_codes_site_idx` ON `static_qr_codes` (`site_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`ticket_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "webauthn_challenges_purpose_chk" CHECK(purpose IN ('register', 'punch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_challenges_challenge_uq` ON `webauthn_challenges` (`challenge`);--> statement-breakpoint
CREATE INDEX `webauthn_challenges_member_idx` ON `webauthn_challenges` (`member_id`,`purpose`);