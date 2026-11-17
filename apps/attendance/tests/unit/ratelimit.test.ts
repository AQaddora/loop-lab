import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { hit, hitIp, RATE_LIMITS } from "@/lib/ratelimit";
import { freshDb } from "../helpers/db";

const T0 = Date.parse("2026-11-17T09:00:00.000Z"); // a minute boundary
let h: Handle;
beforeEach(() => {
  h = freshDb();
});

describe("AC-09 fixed window", () => {
  it("AC-09 fixed window: allows N per window and rejects N+1", () => {
    const N = 10;
    for (let i = 1; i <= N; i++) {
      const r = hit(h.db, "punch:m_emp1", N, 60_000, T0 + i * 1_000);
      expect(r.ok, `hit ${i}`).toBe(true);
      expect(r.count).toBe(i);
    }
    const over = hit(h.db, "punch:m_emp1", N, 60_000, T0 + 59_999);
    expect(over.ok).toBe(false);
    expect(over.count).toBe(N + 1);
    expect(over.retryAfterMs).toBe(1);
    expect(hit(h.db, "punch:m_emp1", N, 60_000, T0 + 59_999).ok).toBe(false);
  });

  it("AC-09 fixed window: resets in the next window (injected clock)", () => {
    for (let i = 0; i < 3; i++) hit(h.db, "k", 3, 60_000, T0 + i);
    expect(hit(h.db, "k", 3, 60_000, T0 + 30_000).ok).toBe(false);
    const next = hit(h.db, "k", 3, 60_000, T0 + 60_000);
    expect(next).toMatchObject({ ok: true, count: 1 });
  });

  it("AC-09 fixed window: keys are independent", () => {
    for (let i = 0; i < 2; i++) hit(h.db, "ip:203.0.113.9", 2, 60_000, T0);
    expect(hit(h.db, "ip:203.0.113.9", 2, 60_000, T0).ok).toBe(false);
    expect(hit(h.db, "ip:198.51.100.23", 2, 60_000, T0).ok).toBe(true);
  });

  it("AC-09 fixed window: spec limits (§2.7 table as revised)", () => {
    expect(RATE_LIMITS.webauthn).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMITS.ipOutside).toEqual({ limit: 30, windowMs: 60_000 });
    expect(RATE_LIMITS.ipInside).toEqual({ limit: 600, windowMs: 60_000 });
    expect(RATE_LIMITS.kioskPair).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMITS.adminWrite).toEqual({ limit: 60, windowMs: 60_000 });
  });

  it("AC-09 fixed window: the shared IP bucket allows 30 from outside and 600 from inside", () => {
    for (let i = 0; i < 30; i++) expect(hitIp(h.db, "203.0.113.9", false, T0).ok).toBe(true);
    expect(hitIp(h.db, "203.0.113.9", false, T0).ok).toBe(false);
    for (let i = 0; i < 31; i++) expect(hitIp(h.db, "198.51.100.23", true, T0).ok).toBe(true);
    for (let i = 0; i < 30; i++) hitIp(h.db, null, true, T0);
    expect(hitIp(h.db, null, true, T0).ok).toBe(false); // unknown IP never gets the office allowance
  });
});
