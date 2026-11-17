import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { attendanceEvents, chainHeads, credentials, scanTickets } from "@/db/schema";
import { verifyChain, type ChainRow } from "@/lib/chain";
import { AppError } from "@/lib/errors";
import { commitPunch, type CommitInput } from "@/lib/punch";
import { freshDb } from "../helpers/db";
import { b64url, seedBasics } from "../helpers/fixtures";

const KEY = "unit-test-log-chain-key-0123456789abcdef0123";
const T0 = Date.parse("2026-11-17T09:00:00.000Z");
let h: Handle;

function ticket(id: string) {
  h.db.insert(scanTickets).values({ id, siteId: "site_hq", source: "rotating", qrWindow: 1, ip: "198.51.100.23", ua: "ua", createdAt: T0, expiresAt: T0 + 300_000, boundMemberId: "m_emp1" }).run();
}

const input = (over: Partial<CommitInput>): CommitInput => ({
  orgId: "org_1",
  memberId: "m_emp1",
  siteId: "site_hq",
  kind: "IN",
  ticketId: "t1",
  credentialRowId: "cred_1",
  newCounter: 0,
  nowMs: T0,
  ip: "198.51.100.23",
  ua: "ua",
  chainKey: KEY,
  maxShiftHours: () => 16,
  ...over,
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
  return undefined;
}

const rows = () => h.db.select().from(attendanceEvents).orderBy(asc(attendanceEvents.seq)).all();
const head = () => h.db.select().from(chainHeads).where(eq(chainHeads.orgId, "org_1")).get() ?? null;
const chainRows = (): ChainRow[] =>
  rows().map((r) => ({ seq: r.seq, org_id: r.orgId, member_id: r.memberId, site_id: r.siteId, kind: r.kind, source: r.source, effective_at: r.effectiveAt, recorded_at: r.recordedAt, credential_id: r.credentialId, ticket_id: r.ticketId, corrects_seq: r.correctsSeq, reason: r.reason, actor_member_id: r.actorMemberId, prev_hash: r.prevHash, hash: r.hash }));

beforeEach(() => {
  h = freshDb();
  seedBasics(h);
  h.db.insert(credentials).values({ id: "cred_1", memberId: "m_emp1", credentialId: b64url(16), publicKey: b64url(64), backupEligible: false, backupState: false, status: "APPROVED", createdAt: T0 }).run();
  for (const t of ["t1", "t2", "t3"]) ticket(t);
});

describe("AC-41 atomic punch commit", () => {
  it("AC-41 atomic punch commit: two commits with the same ticket -> the second ticket_used", () => {
    const ev = commitPunch(h, input({ kind: "IN", ticketId: "t1" }));
    expect(ev).toMatchObject({ seq: 1, kind: "IN", recordedAt: T0, effectiveAt: T0 });
    expect(codeOf(() => commitPunch(h, input({ kind: "OUT", ticketId: "t1", nowMs: T0 + 61_000 })))).toBe("ticket_used");
    expect(rows()).toHaveLength(1);
    const t = h.db.select().from(scanTickets).where(eq(scanTickets.id, "t1")).get();
    expect(t?.usedAt).toBe(T0);
    expect(t?.eventId).toBe(ev.id);
  });

  it("AC-41 atomic punch commit: two commits of IN with different tickets -> the second already_in", () => {
    commitPunch(h, input({ kind: "IN", ticketId: "t1" }));
    expect(codeOf(() => commitPunch(h, input({ kind: "IN", ticketId: "t2", nowMs: T0 + 120_000 })))).toBe("already_in");
    expect(rows()).toHaveLength(1);
  });

  it("AC-41 atomic punch commit: a failed commit leaves no event, no used ticket and an unchanged chain head", () => {
    commitPunch(h, input({ kind: "IN", ticketId: "t1" }));
    const headBefore = head();
    const credBefore = h.db.select().from(credentials).where(eq(credentials.id, "cred_1")).get();
    for (const bad of [
      input({ kind: "IN", ticketId: "t2", nowMs: T0 + 120_000, newCounter: 7 }), // already_in
      input({ kind: "OUT", ticketId: "t2", nowMs: T0 + 30_000, newCounter: 7 }), // too_soon
      input({ kind: "OUT", ticketId: "t1", nowMs: T0 + 120_000, newCounter: 7 }), // ticket_used
      input({ kind: "OUT", ticketId: "nope", nowMs: T0 + 120_000, newCounter: 7 }), // unknown ticket
    ]) {
      expect(codeOf(() => commitPunch(h, bad))).toBeTruthy();
      expect(rows()).toHaveLength(1);
      expect(head()).toEqual(headBefore);
      expect(h.db.select().from(scanTickets).where(eq(scanTickets.id, "t2")).get()?.usedAt).toBeNull();
      expect(h.db.select().from(credentials).where(eq(credentials.id, "cred_1")).get()).toEqual(credBefore);
    }
    expect(codeOf(() => commitPunch(h, input({ kind: "OUT", ticketId: "t2", nowMs: T0 + 30_000 })))).toBe("too_soon");
  });

  it("AC-41 atomic punch commit: seqs stay consecutive and the chain verifies; counter and last_used move", () => {
    commitPunch(h, input({ kind: "IN", ticketId: "t1", newCounter: 1 }));
    commitPunch(h, input({ kind: "OUT", ticketId: "t2", nowMs: T0 + 61_000, newCounter: 2 }));
    commitPunch(h, input({ kind: "IN", ticketId: "t3", nowMs: T0 + 3_600_000, newCounter: 3 }));
    expect(rows().map((r) => [r.seq, r.kind])).toEqual([[1, "IN"], [2, "OUT"], [3, "IN"]]);
    expect(head()).toMatchObject({ seq: 3, hash: rows()[2].hash });
    expect(verifyChain(chainRows(), KEY, head())).toEqual({ ok: true, firstBadSeq: null });
    expect(h.db.select().from(credentials).where(eq(credentials.id, "cred_1")).get()).toMatchObject({ counter: 3, lastUsedAt: T0 + 3_600_000 });
    // client-chosen times cannot exist here: effective_at = recorded_at = the server's nowMs
    expect(rows().every((r) => r.effectiveAt === r.recordedAt)).toBe(true);
  });
});
