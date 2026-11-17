ALTER TABLE `sites` ADD `max_shift_hours` integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE `webauthn_challenges` ADD `kind` text;--> statement-breakpoint
-- spec §2.6 (AC-28): DELETE still aborts; UPDATE of any column except ip/ua aborts; ip/ua may only become NULL (retention, OD-5).
-- A column added to attendance_events or audit_log later MUST be added to its `UPDATE OF` list in a new migration.
DROP TRIGGER IF EXISTS `attendance_events_no_update`;
--> statement-breakpoint
CREATE TRIGGER `attendance_events_no_update`
BEFORE UPDATE OF `id`, `org_id`, `seq`, `member_id`, `site_id`, `kind`, `source`, `effective_at`, `recorded_at`, `credential_id`, `ticket_id`, `corrects_seq`, `reason`, `actor_member_id`, `prev_hash`, `hash` ON `attendance_events`
BEGIN
  SELECT RAISE(ABORT, 'attendance_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `attendance_events_ip_ua_null_only`
BEFORE UPDATE OF `ip`, `ua` ON `attendance_events`
WHEN (NEW.`ip` IS NOT NULL AND NEW.`ip` IS NOT OLD.`ip`) OR (NEW.`ua` IS NOT NULL AND NEW.`ua` IS NOT OLD.`ua`)
BEGIN
  SELECT RAISE(ABORT, 'attendance_events is append-only (ip/ua may only be set to NULL)');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `audit_log_no_update`;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update`
BEFORE UPDATE OF `id`, `org_id`, `actor_member_id`, `action`, `target_type`, `target_id`, `detail_json`, `at` ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_ip_null_only`
BEFORE UPDATE OF `ip` ON `audit_log`
WHEN NEW.`ip` IS NOT NULL AND NEW.`ip` IS NOT OLD.`ip`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only (ip may only be set to NULL)');
END;
