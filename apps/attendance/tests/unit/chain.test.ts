import { describe, expect, it } from "vitest";
import {
  canonicalJSON,
  computeHash,
  GENESIS_HASH,
  link,
  verifyChain,
  type ChainFields,
  type ChainRow,
} from "@/lib/chain";

const KEY = "unit-test-log-chain-key-0123456789abcdef0123";
const T0 = Date.parse("2026-11-17T09:00:00.000Z");

function buildChain(n: number, key = KEY): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let i = 0; i < n; i++) {
    const prev = rows.at(-1) ?? null;
    const fields: Omit<ChainFields, "seq"> = {
      org_id: "org_1",
      member_id: i % 2 === 0 ? "m_emp1" : "m_emp2",
      site_id: "site_hq",
      kind: i % 4 < 2 ? "IN" : "OUT",
      source: "PUNCH",
      effective_at: T0 + i * 61_000,
      recorded_at: T0 + i * 61_000,
      credential_id: `cred_${i}`,
      ticket_id: `tkt_${i}`,
      corrects_seq: null,
      reason: null,
      actor_member_id: null,
    };
    const l = link(prev ? { seq: prev.seq, hash: prev.hash } : null, fields, key);
    rows.push({ ...fields, seq: l.seq, prev_hash: l.prevHash, hash: l.hash });
  }
  return rows;
}

const head = (rows: ChainRow[]) => ({ seq: rows.at(-1)!.seq, hash: rows.at(-1)!.hash });

describe("AC-06 chain verify", () => {
  it("AC-06 chain verify: ok on an intact chain (with and without the head)", () => {
    const rows = buildChain(6);
    expect(rows[0].prev_hash).toBe(GENESIS_HASH);
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(rows, KEY)).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain(rows, KEY, head(rows))).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain([], KEY, null)).toEqual({ ok: true, firstBadSeq: null });
  });

  it("AC-06 chain verify: a modified row -> its seq", () => {
    for (const [field, value] of [
      ["kind", "VOID"],
      ["effective_at", T0 - 3_600_000],
      ["member_id", "m_other"],
      ["reason", "x"],
      ["corrects_seq", 1],
      ["site_id", null],
    ] as const) {
      const rows = buildChain(6);
      (rows[3] as Record<string, unknown>)[field] = value;
      expect(verifyChain(rows, KEY), field).toEqual({ ok: false, firstBadSeq: 4 });
    }
    const rehashedWithoutKey = buildChain(6);
    rehashedWithoutKey[2].hash = "f".repeat(64);
    expect(verifyChain(rehashedWithoutKey, KEY)).toEqual({ ok: false, firstBadSeq: 3 });
  });

  it("AC-06 chain verify: ip and ua sit outside the hash (purgeable)", () => {
    const rows = buildChain(3).map((r) => ({ ...r, ip: "198.51.100.23", ua: "UA" }));
    const purged = rows.map((r) => ({ ...r, ip: null, ua: null }));
    expect(verifyChain(purged, KEY)).toEqual({ ok: true, firstBadSeq: null });
  });

  it("AC-06 chain verify: a deleted row -> the missing seq; a truncated tail is caught by the head", () => {
    const rows = buildChain(6);
    const deleted = [...rows.slice(0, 2), ...rows.slice(3)];
    expect(verifyChain(deleted, KEY)).toEqual({ ok: false, firstBadSeq: 3 });
    const first = rows.slice(1);
    expect(verifyChain(first, KEY)).toEqual({ ok: false, firstBadSeq: 1 });
    const truncated = rows.slice(0, 5);
    expect(verifyChain(truncated, KEY, head(rows))).toEqual({ ok: false, firstBadSeq: 6 });
    // rows beyond the recorded head, or a head whose hash does not match
    expect(verifyChain(rows, KEY, head(truncated))).toEqual({ ok: false, firstBadSeq: 6 });
    expect(verifyChain(rows, KEY, { seq: 6, hash: "e".repeat(64) })).toEqual({ ok: false, firstBadSeq: 6 });
  });

  it("AC-06 chain verify: a reordered row -> first out-of-place seq", () => {
    const rows = buildChain(6);
    const swapped = [rows[0], rows[2], rows[1], ...rows.slice(3)];
    expect(verifyChain(swapped, KEY)).toEqual({ ok: false, firstBadSeq: 2 });
    // swap the contents but keep the seq numbers in order
    const contentSwap = buildChain(6);
    const a = { ...contentSwap[1] };
    const b = { ...contentSwap[2] };
    contentSwap[1] = { ...b, seq: 2 };
    contentSwap[2] = { ...a, seq: 3 };
    expect(verifyChain(contentSwap, KEY)).toEqual({ ok: false, firstBadSeq: 2 });
  });

  it("AC-06 chain verify: wrong key fails at seq 1", () => {
    const rows = buildChain(4);
    expect(verifyChain(rows, "a-different-chain-key-0123456789abcdef0123")).toEqual({ ok: false, firstBadSeq: 1 });
    expect(() => verifyChain(rows, "short")).toThrow();
  });

  it("canonical JSON is key-sorted, compact and covers exactly the 13 hashed fields", () => {
    const f = buildChain(1)[0];
    const c = canonicalJSON({ ...f, ip: "x", ua: "y" } as unknown as ChainFields);
    const parsed = JSON.parse(c);
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(Object.keys(parsed)).toHaveLength(13);
    expect(c).not.toMatch(/\s/);
    expect(c).not.toContain("prev_hash");
    expect(computeHash(GENESIS_HASH, f, KEY)).toBe(f.hash);
  });
});
