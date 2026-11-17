/**
 * Passkeys (spec §2.4) with @simplewebauthn/server. Library functions take DB, clock and config as parameters.
 */
import { createHmac } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeAttestationObject, isoBase64URL, parseAuthenticatorData } from "@simplewebauthn/server/helpers";
import { and, eq, inArray, isNull, gt } from "drizzle-orm";
import type { DB } from "@/db";
import { credentials, orgs, webauthnChallenges, type Member, type ScanTicket, type WebauthnChallenge } from "@/db/schema";
import { AppError } from "./errors";
import { randomB64url, randomId } from "./ids";

export type RpConfig = { rpID: string; rpName: string; origin: string; challengeTtlMs: number };

export function rpConfig(env: Record<string, string | undefined> = process.env): RpConfig {
  const rpID = env.WEBAUTHN_RP_ID;
  const origin = env.WEBAUTHN_ORIGIN;
  if (!rpID || !origin) throw new Error("WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be set");
  const ttl = Number(env.WEBAUTHN_CHALLENGE_TTL_SECONDS ?? 60);
  return { rpID, origin, rpName: env.WEBAUTHN_RP_NAME || "Attendance", challengeTtlMs: (Number.isInteger(ttl) && ttl > 0 ? ttl : 60) * 1000 };
}

// ---- confirm code -------------------------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** base32(HMAC-SHA256(QR_SIGNING_SECRET, "confirm:" + credential_id)), first 6 chars (spec §2.4). */
export function confirmCode(credentialId: string, secret: string): string {
  if (Buffer.byteLength(secret) < 32) throw new Error("QR_SIGNING_SECRET must be 32+ bytes");
  return base32(createHmac("sha256", secret).update(`confirm:${credentialId}`).digest()).slice(0, 6);
}

// ---- challenges ---------------------------------------------------------------------------------
export function storeChallenge(
  db: DB,
  c: { memberId: string; purpose: "register" | "punch"; challenge: string; ticketId: string; kind?: "IN" | "OUT" | null; nowMs: number; ttlMs: number },
): void {
  db.insert(webauthnChallenges)
    .values({ id: randomId("ch_"), memberId: c.memberId, purpose: c.purpose, challenge: c.challenge, ticketId: c.ticketId, kind: c.kind ?? null, createdAt: c.nowMs, expiresAt: c.nowMs + c.ttlMs })
    .run();
}

/** The `challenge` inside clientDataJSON (base64url JSON), or null. */
export function challengeFromClientData(clientDataJSON: unknown): string | null {
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > 8192) return null;
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/**
 * Consume atomically (spec §2.4): unknown / other member / other purpose / other ticket / other kind ->
 * challenge_invalid; already used -> challenge_used; late -> challenge_expired.
 */
export function consumeChallenge(
  db: DB,
  q: { challenge: string | null; memberId: string; purpose: "register" | "punch"; ticketId: string | null; kind?: "IN" | "OUT" | null; nowMs: number },
): WebauthnChallenge {
  if (!q.challenge) throw new AppError("challenge_invalid");
  const row = db.select().from(webauthnChallenges).where(eq(webauthnChallenges.challenge, q.challenge)).get();
  if (!row || row.memberId !== q.memberId || row.purpose !== q.purpose || row.ticketId === null || row.ticketId !== q.ticketId) {
    throw new AppError("challenge_invalid");
  }
  if (q.purpose === "punch" && row.kind !== (q.kind ?? null)) throw new AppError("challenge_invalid");
  const used = db
    .update(webauthnChallenges)
    .set({ usedAt: q.nowMs })
    .where(and(eq(webauthnChallenges.id, row.id), isNull(webauthnChallenges.usedAt), gt(webauthnChallenges.expiresAt, q.nowMs)))
    .returning()
    .get();
  if (!used) throw new AppError(row.usedAt !== null ? "challenge_used" : "challenge_expired");
  return used;
}

// ---- registration -------------------------------------------------------------------------------
export async function registrationOptions(db: DB, member: Member, rp: RpConfig) {
  const existing = db
    .select({ credentialId: credentials.credentialId, transports: credentials.transports })
    .from(credentials)
    .where(and(eq(credentials.memberId, member.id), inArray(credentials.status, ["PENDING", "APPROVED"])))
    .all();
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: isoBase64URL.toBuffer(member.webauthnUserId),
    userName: member.email,
    userDisplayName: member.fullName ?? member.email,
    attestationType: "none",
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ? (JSON.parse(c.transports) as never) : undefined })),
    timeout: 60_000,
  });
}

/** Was the UV flag set in the signed authenticator data of this registration? */
function attestationUv(response: RegistrationResponseJSON): boolean | null {
  try {
    const att = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    return parseAuthenticatorData(att.get("authData")).flags.uv;
  } catch {
    return null;
  }
}

export type RegisterInput = {
  member: Member;
  ticket: ScanTicket;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  ip: string;
  ua: string | null;
  nowMs: number;
  rp: RpConfig;
};

/**
 * Verify + store as PENDING (spec §2.4). UV failure -> uv_required; any other verify failure -> assertion_invalid;
 * BE=1 with orgs.allow_synced_passkeys=false -> synced_not_allowed. Returns a function that writes the rows,
 * so the caller can run it inside one synchronous transaction (an older PENDING is superseded there).
 */
export async function verifyRegistration(db: DB, x: RegisterInput) {
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: x.response,
      expectedChallenge: x.expectedChallenge,
      expectedOrigin: x.rp.origin,
      expectedRPID: x.rp.rpID,
      requireUserVerification: true,
    });
    if (!v.verified) throw new AppError("assertion_invalid");
    info = v.registrationInfo;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(attestationUv(x.response) === false ? "uv_required" : "assertion_invalid");
  }
  if (!info.userVerified) throw new AppError("uv_required");

  const backupEligible = info.credentialDeviceType === "multiDevice";
  const org = db.select({ allow: orgs.allowSyncedPasskeys }).from(orgs).where(eq(orgs.id, x.member.orgId)).get();
  if (backupEligible && org?.allow === false) throw new AppError("synced_not_allowed");

  const credentialId = info.credential.id;
  if (db.select({ id: credentials.id }).from(credentials).where(eq(credentials.credentialId, credentialId)).get()) {
    throw new AppError("assertion_invalid");
  }
  const row = {
    id: randomId("cred_"),
    memberId: x.member.id,
    credentialId,
    publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
    counter: info.credential.counter,
    transports: JSON.stringify(x.response.response.transports ?? info.credential.transports ?? []),
    aaguid: info.aaguid,
    deviceType: info.credentialDeviceType,
    backupEligible,
    backupState: info.credentialBackedUp,
    attachment: typeof x.response.authenticatorAttachment === "string" ? x.response.authenticatorAttachment : null,
    regIp: x.ip,
    regUa: x.ua ? x.ua.slice(0, 512) : null,
    regSiteId: x.ticket.siteId,
    regTicketId: x.ticket.id,
    status: "PENDING" as const,
    createdAt: x.nowMs,
  };
  return () => {
    db.update(credentials)
      .set({ status: "REJECTED", decisionNote: "superseded", decidedAt: x.nowMs })
      .where(and(eq(credentials.memberId, x.member.id), eq(credentials.status, "PENDING")))
      .run();
    db.insert(credentials).values(row).run();
    return row;
  };
}

export { randomB64url };
