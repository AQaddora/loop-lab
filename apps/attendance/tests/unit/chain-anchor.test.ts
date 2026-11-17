import { describe, expect, it } from "vitest";
import { link, verifyChain, type ChainFields, type ChainRow } from "@/lib/chain";

const KEY = "unit-test-log-chain-key-0123456789abcdef0123";
const T0 = Date.parse("2026-11-17T09:00:00.000Z");

function buildChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let i = 0; i < n; i++) {
    const prev = rows.at(-1);
    const fields: Omit<ChainFields, "seq"> = {
      org_id: "org_1",
      member_id: "m_emp1",
      site_id: "site_hq",
      kind: i % 2 === 0 ? "IN" : "OUT",
      source: "PUNCH",
      effective_at: T0 + i * 61_000,
      recorded_at: T0 + i * 61_000,
      credential_id: "cred",
      ticket_id: `tkt_${i}`,
      corrects_seq: null,
      reason: null,
      actor_member_id: null,
    };
    const l = link(prev ? { seq: prev.seq, hash: prev.hash } : null, fields, KEY);
    rows.push({ ...fields, seq: l.seq, prev_hash: l.prevHash, hash: l.hash });
  }
  return rows;
}

describe("AC-06 chain verify (anchor / tail cut)", () => {
  it("AC-06 chain verify: cutting the newest rows passes a plain verify but fails at the anchored seq", () => {
    const rows = buildChain(8);
    const anchor = { seq: 6, hash: rows[5].hash };
    const cut = rows.slice(0, 4); // rows 5..8 deleted, chain_heads rewound to 4
    const rewoundHead = { seq: 4, hash: rows[3].hash };
    expect(verifyChain(cut, KEY)).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain(cut, KEY, { head: rewoundHead })).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain(cut, KEY, { head: rewoundHead, anchor })).toEqual({ ok: false, firstBadSeq: 6 });
    expect(verifyChain(cut, KEY, { anchor })).toEqual({ ok: false, firstBadSeq: 6 });
  });

  it("AC-06 chain verify: rows after the anchor are fine; the anchored row must match", () => {
    const rows = buildChain(8);
    expect(verifyChain(rows, KEY, { anchor: { seq: 6, hash: rows[5].hash } })).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain(rows.slice(0, 6), KEY, { anchor: { seq: 6, hash: rows[5].hash } })).toEqual({ ok: true, firstBadSeq: null });
    expect(verifyChain(rows, KEY, { anchor: { seq: 6, hash: "0".repeat(64) } })).toEqual({ ok: false, firstBadSeq: 6 });
  });

  it("AC-06 chain verify: a break before the anchor is still reported at its own seq", () => {
    const rows = buildChain(8);
    rows[2] = { ...rows[2], kind: "VOID" };
    expect(verifyChain(rows, KEY, { anchor: { seq: 6, hash: rows[5].hash } })).toEqual({ ok: false, firstBadSeq: 3 });
  });

  it("AC-06 chain verify: deleting a middle row is caught without any anchor", () => {
    const rows = buildChain(5);
    expect(verifyChain([...rows.slice(0, 1), ...rows.slice(2)], KEY)).toEqual({ ok: false, firstBadSeq: 2 });
  });
});
