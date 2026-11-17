/**
 * Tamper-evident attendance log (spec §2.6, AC-06).
 *
 *   hash = HMAC-SHA256(LOG_CHAIN_KEY, prev_hash + canonicalJSON({seq, org_id, member_id, site_id, kind, source,
 *          effective_at, recorded_at, credential_id, ticket_id, corrects_seq, reason, actor_member_id}))
 *
 * Genesis prev_hash = 64 zeros. ip and ua are outside the hash. The key is never stored in the DB.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

/** The hashed fields of one attendance_events row, in DB (snake_case) naming. */
export type ChainFields = {
  seq: number;
  org_id: string;
  member_id: string;
  site_id: string | null;
  kind: "IN" | "OUT" | "VOID";
  source: "PUNCH" | "ADMIN";
  effective_at: number;
  recorded_at: number;
  credential_id: string | null;
  ticket_id: string | null;
  corrects_seq: number | null;
  reason: string | null;
  actor_member_id: string | null;
};

export const CHAIN_FIELD_NAMES = [
  "seq",
  "org_id",
  "member_id",
  "site_id",
  "kind",
  "source",
  "effective_at",
  "recorded_at",
  "credential_id",
  "ticket_id",
  "corrects_seq",
  "reason",
  "actor_member_id",
] as const satisfies readonly (keyof ChainFields)[];

export type ChainRow = ChainFields & { prev_hash: string; hash: string };

export type ChainHead = { seq: number; hash: string };

export type VerifyResult = { ok: true; firstBadSeq: null } | { ok: false; firstBadSeq: number };

export function assertChainKey(key: string | undefined): string {
  if (typeof key !== "string" || Buffer.byteLength(key) < 32) {
    throw new Error("LOG_CHAIN_KEY must be set to 32+ bytes");
  }
  return key;
}

/** Canonical JSON: the 13 hashed fields only, keys sorted, no whitespace, missing -> null. */
export function canonicalJSON(fields: ChainFields): string {
  const keys = [...CHAIN_FIELD_NAMES].sort();
  const parts = keys.map((k) => {
    const v = (fields as Record<string, unknown>)[k];
    const val = v === undefined ? null : v;
    if (val !== null && typeof val !== "string" && !(typeof val === "number" && Number.isFinite(val))) {
      throw new Error(`chain field ${k} must be string, finite number or null`);
    }
    return `${JSON.stringify(k)}:${JSON.stringify(val)}`;
  });
  return `{${parts.join(",")}}`;
}

export function computeHash(prevHash: string, fields: ChainFields, key: string): string {
  return createHmac("sha256", assertChainKey(key))
    .update(prevHash + canonicalJSON(fields))
    .digest("hex");
}

/** Build the next link: what to store as prev_hash / hash for a new row. */
export function link(prev: ChainHead | null, fields: Omit<ChainFields, "seq">, key: string) {
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const full: ChainFields = { ...fields, seq } as ChainFields;
  return { seq, prevHash, hash: computeHash(prevHash, full, key) };
}

function hexEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify one org's chain. `rows` must be that org's rows in ascending seq order as read from the DB.
 * Returns the first seq at which the chain breaks: a modified row (its seq), a deleted row (the missing
 * seq), a reordered row, or a wrong key (seq 1). With `head` (chain_heads), a truncated tail is caught too.
 */
export function verifyChain(rows: readonly ChainRow[], key: string, head?: ChainHead | null): VerifyResult {
  assertChainKey(key);
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const expectedSeq = i + 1;
    const r = rows[i];
    if (r.seq !== expectedSeq) return { ok: false, firstBadSeq: expectedSeq };
    if (!hexEqual(r.prev_hash, prevHash)) return { ok: false, firstBadSeq: expectedSeq };
    if (!hexEqual(r.hash, computeHash(prevHash, r, key))) return { ok: false, firstBadSeq: expectedSeq };
    prevHash = r.hash;
  }
  if (head) {
    const last = rows.length;
    if (head.seq > last) return { ok: false, firstBadSeq: last + 1 }; // tail rows deleted
    if (head.seq < last) return { ok: false, firstBadSeq: head.seq + 1 }; // rows beyond the head
    if (last > 0 && !hexEqual(head.hash, prevHash)) return { ok: false, firstBadSeq: last };
  }
  return { ok: true, firstBadSeq: null };
}
