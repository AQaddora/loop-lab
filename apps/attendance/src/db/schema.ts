/**
 * Data model, spec §4. SQLite for dev and test; Postgres-ready (no SQLite-only SQL outside migrations).
 * All times are UTC epoch milliseconds (integer). Ids are random text unless noted.
 * attendance_events and audit_log are append-only: BEFORE UPDATE/DELETE triggers live in the custom
 * migration drizzle/0001_append_only_triggers.sql (AC-28).
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const MEMBER_ROLES = ["owner", "admin", "employee"] as const;
export const MEMBER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"] as const;
export const QR_MODES = ["rotating", "static"] as const;
export const SITE_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const CREDENTIAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;
export const CHALLENGE_PURPOSES = ["register", "punch"] as const;
export const TICKET_SOURCES = ["rotating", "static"] as const;
export const STATIC_QR_STATUSES = ["ACTIVE", "REVOKED"] as const;
export const KIOSK_STATUSES = ["PAIRING", "ACTIVE", "REVOKED"] as const;
export const EVENT_KINDS = ["IN", "OUT", "VOID"] as const;
export const EVENT_SOURCES = ["PUNCH", "ADMIN"] as const;

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  allowedGoogleHd: text("allowed_google_hd"),
  allowSyncedPasskeys: integer("allow_synced_passkeys", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    qrMode: text("qr_mode", { enum: QR_MODES }).notNull().default("rotating"),
    rotationSeconds: integer("rotation_seconds").notNull().default(30),
    graceWindows: integer("grace_windows").notNull().default(1),
    qrKeyVersion: integer("qr_key_version").notNull().default(1),
    status: text("status", { enum: SITE_STATUSES }).notNull().default("ACTIVE"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("sites_org_idx").on(t.orgId),
    check("sites_qr_mode_chk", inList("qr_mode", QR_MODES)),
    check("sites_status_chk", inList("status", SITE_STATUSES)),
    check("sites_rotation_chk", sql`${t.rotationSeconds} > 0`),
    check("sites_grace_chk", sql`${t.graceWindows} >= 0`),
    check("sites_key_version_chk", sql`${t.qrKeyVersion} >= 1`),
  ],
);

export const siteNetworks = sqliteTable(
  "site_networks",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    /** normalised CIDR, IPv4 or IPv6 */
    cidr: text("cidr").notNull(),
    label: text("label"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("site_networks_site_cidr_uq").on(t.siteId, t.cidr)],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    /** always lower-case (CHECK) */
    email: text("email").notNull(),
    employeeCode: text("employee_code"),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("INVITED"),
    /** Google `sub`, pinned at first login (spec §2.3 step 4) */
    googleSub: text("google_sub"),
    /** per-member random 32 bytes, base64url; never the email (spec §2.4) */
    webauthnUserId: text("webauthn_user_id").notNull(),
    fullName: text("full_name"),
    phone: text("phone"),
    profileCompletedAt: integer("profile_completed_at"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => [
    uniqueIndex("members_email_uq").on(t.email),
    uniqueIndex("members_google_sub_uq").on(t.googleSub),
    uniqueIndex("members_webauthn_user_id_uq").on(t.webauthnUserId),
    index("members_org_idx").on(t.orgId),
    check("members_email_lower_chk", sql`${t.email} = lower(${t.email})`),
    check("members_role_chk", inList("role", MEMBER_ROLES)),
    check("members_status_chk", inList("status", MEMBER_STATUSES)),
  ],
);

export const credentials = sqliteTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    /** WebAuthn credential id, base64url */
    credentialId: text("credential_id").notNull(),
    /** COSE public key, base64url */
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    /** JSON array of transports */
    transports: text("transports"),
    aaguid: text("aaguid"),
    deviceType: text("device_type"),
    backupEligible: integer("backup_eligible", { mode: "boolean" }).notNull(),
    backupState: integer("backup_state", { mode: "boolean" }).notNull(),
    /** client-reported authenticatorAttachment: unsigned, recorded only */
    attachment: text("attachment"),
    regIp: text("reg_ip"),
    regUa: text("reg_ua"),
    regSiteId: text("reg_site_id").references(() => sites.id),
    regTicketId: text("reg_ticket_id"),
    status: text("status", { enum: CREDENTIAL_STATUSES }).notNull().default("PENDING"),
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("credentials_credential_id_uq").on(t.credentialId),
    // invariants (spec §2.4): at most one APPROVED and one PENDING credential per member
    uniqueIndex("credentials_one_approved_uq").on(t.memberId).where(sql`status = 'APPROVED'`),
    uniqueIndex("credentials_one_pending_uq").on(t.memberId).where(sql`status = 'PENDING'`),
    index("credentials_member_idx").on(t.memberId),
    check("credentials_status_chk", inList("status", CREDENTIAL_STATUSES)),
    check("credentials_counter_chk", sql`${t.counter} >= 0`),
  ],
);

export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    purpose: text("purpose", { enum: CHALLENGE_PURPOSES }).notNull(),
    challenge: text("challenge").notNull(),
    ticketId: text("ticket_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [
    uniqueIndex("webauthn_challenges_challenge_uq").on(t.challenge),
    index("webauthn_challenges_member_idx").on(t.memberId, t.purpose),
    check("webauthn_challenges_purpose_chk", inList("purpose", CHALLENGE_PURPOSES)),
  ],
);

export const scanTickets = sqliteTable(
  "scan_tickets",
  {
    /** 128-bit random, base64url */
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    source: text("source", { enum: TICKET_SOURCES }).notNull(),
    qrWindow: integer("qr_window"),
    staticQrId: text("static_qr_id"),
    ip: text("ip"),
    ua: text("ua"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    boundMemberId: text("bound_member_id").references(() => members.id),
    usedAt: integer("used_at"),
    eventId: text("event_id"),
  },
  (t) => [
    index("scan_tickets_site_idx").on(t.siteId),
    check("scan_tickets_source_chk", inList("source", TICKET_SOURCES)),
  ],
);

export const staticQrCodes = sqliteTable(
  "static_qr_codes",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    label: text("label"),
    issuedBy: text("issued_by"),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    status: text("status", { enum: STATIC_QR_STATUSES }).notNull().default("ACTIVE"),
  },
  (t) => [
    index("static_qr_codes_site_idx").on(t.siteId),
    check("static_qr_codes_status_chk", inList("status", STATIC_QR_STATUSES)),
  ],
);

export const kiosks = sqliteTable(
  "kiosks",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    name: text("name").notNull(),
    /** sha256 of the kiosk cookie token */
    tokenHash: text("token_hash"),
    /** sha256 of the one-time pairing code */
    pairingCodeHash: text("pairing_code_hash"),
    pairingExpiresAt: integer("pairing_expires_at"),
    status: text("status", { enum: KIOSK_STATUSES }).notNull().default("PAIRING"),
    lastSeenAt: integer("last_seen_at"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("kiosks_token_hash_uq").on(t.tokenHash),
    uniqueIndex("kiosks_pairing_code_hash_uq").on(t.pairingCodeHash),
    check("kiosks_status_chk", inList("status", KIOSK_STATUSES)),
  ],
);

export const attendanceEvents = sqliteTable(
  "attendance_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    seq: integer("seq").notNull(),
    memberId: text("member_id").notNull().references(() => members.id),
    siteId: text("site_id").references(() => sites.id),
    kind: text("kind", { enum: EVENT_KINDS }).notNull(),
    source: text("source", { enum: EVENT_SOURCES }).notNull(),
    effectiveAt: integer("effective_at").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    credentialId: text("credential_id"),
    ticketId: text("ticket_id"),
    correctsSeq: integer("corrects_seq"),
    reason: text("reason"),
    actorMemberId: text("actor_member_id").references(() => members.id),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    /** outside the hash: may be purged under the retention policy (OD-5) */
    ip: text("ip"),
    ua: text("ua"),
  },
  (t) => [
    uniqueIndex("attendance_events_org_seq_uq").on(t.orgId, t.seq),
    index("attendance_events_member_idx").on(t.memberId, t.effectiveAt),
    check("attendance_events_kind_chk", inList("kind", EVENT_KINDS)),
    check("attendance_events_source_chk", inList("source", EVENT_SOURCES)),
    check("attendance_events_seq_chk", sql`${t.seq} >= 1`),
    check("attendance_events_void_chk", sql`${t.kind} <> 'VOID' OR ${t.correctsSeq} IS NOT NULL`),
    check(
      "attendance_events_admin_chk",
      sql`${t.source} <> 'ADMIN' OR (${t.reason} IS NOT NULL AND ${t.actorMemberId} IS NOT NULL)`,
    ),
  ],
);

export const chainHeads = sqliteTable("chain_heads", {
  orgId: text("org_id").primaryKey().references(() => orgs.id),
  seq: integer("seq").notNull(),
  hash: text("hash").notNull(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    actorMemberId: text("actor_member_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    ip: text("ip"),
    at: integer("at").notNull(),
  },
  (t) => [index("audit_log_org_at_idx").on(t.orgId, t.at)],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type Org = typeof orgs.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type SiteNetwork = typeof siteNetworks.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect;
export type ScanTicket = typeof scanTickets.$inferSelect;
export type StaticQrCode = typeof staticQrCodes.$inferSelect;
export type Kiosk = typeof kiosks.$inferSelect;
export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
