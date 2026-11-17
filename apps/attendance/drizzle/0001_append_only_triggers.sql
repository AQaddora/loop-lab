-- Custom migration (spec §2.6, AC-28): attendance_events and audit_log are append-only at DB level.
CREATE TRIGGER `attendance_events_no_update` BEFORE UPDATE ON `attendance_events`
BEGIN
  SELECT RAISE(ABORT, 'attendance_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `attendance_events_no_delete` BEFORE DELETE ON `attendance_events`
BEGIN
  SELECT RAISE(ABORT, 'attendance_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
