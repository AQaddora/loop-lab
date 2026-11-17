import { describe, expect, it } from "vitest";
import { checkTransition, currentState, nextAction, type StateEvent } from "@/lib/punch-state";

const T0 = Date.parse("2026-11-17T08:00:00.000Z");
const H = 3_600_000;
const shifts = (siteId: string | null) => (siteId === "site_night" ? 12 : 16);

describe("AC-07 transitions (stale IN, ties)", () => {
  it("AC-07 transitions: an IN older than its site's max_shift_hours counts as OUT", () => {
    const events: StateEvent[] = [{ seq: 1, kind: "IN", effectiveAt: T0, correctsSeq: null, siteId: "site_hq" }];
    const at = (ms: number) => ({ nowMs: ms, maxShiftHours: shifts });
    expect(currentState(events, at(T0 + 16 * H))).toBe("IN");
    expect(currentState(events, at(T0 + 16 * H + 1))).toBe("OUT");
    expect(nextAction(events, at(T0 + 17 * H))).toBe("IN");
    // next day: check-in is not blocked by the forgotten check-out
    expect(checkTransition(events, "IN", T0 + 24 * H, 60_000, shifts)).toEqual({ ok: true });
    expect(checkTransition(events, "OUT", T0 + 24 * H, 60_000, shifts)).toEqual({ ok: false, error: "not_in" });
    // still inside the shift: a second IN is already_in
    expect(checkTransition(events, "IN", T0 + 8 * H, 60_000, shifts)).toEqual({ ok: false, error: "already_in" });
  });

  it("AC-07 transitions: max_shift_hours is per site", () => {
    const night: StateEvent[] = [{ seq: 1, kind: "IN", effectiveAt: T0, correctsSeq: null, siteId: "site_night" }];
    expect(checkTransition(night, "IN", T0 + 13 * H, 60_000, shifts)).toEqual({ ok: true });
    const hq: StateEvent[] = [{ seq: 1, kind: "IN", effectiveAt: T0, correctsSeq: null, siteId: "site_hq" }];
    expect(checkTransition(hq, "IN", T0 + 13 * H, 60_000, shifts)).toEqual({ ok: false, error: "already_in" });
  });

  it("AC-07 transitions: equal effective_at -> higher seq wins", () => {
    const tie: StateEvent[] = [
      { seq: 7, kind: "OUT", effectiveAt: T0, correctsSeq: null, siteId: "site_hq" },
      { seq: 5, kind: "IN", effectiveAt: T0, correctsSeq: null, siteId: "site_hq" },
    ];
    expect(currentState(tie)).toBe("OUT");
    const tie2: StateEvent[] = [
      { seq: 5, kind: "OUT", effectiveAt: T0, correctsSeq: null },
      { seq: 7, kind: "IN", effectiveAt: T0, correctsSeq: null },
    ];
    expect(currentState(tie2)).toBe("IN");
  });

  it("AC-07 transitions: already_in / not_in win over too_soon when both apply", () => {
    const justIn: StateEvent[] = [{ seq: 1, kind: "IN", effectiveAt: T0, correctsSeq: null, siteId: "site_hq" }];
    expect(checkTransition(justIn, "IN", T0 + 1_000, 60_000, shifts)).toEqual({ ok: false, error: "already_in" });
    const justOut: StateEvent[] = [...justIn, { seq: 2, kind: "OUT", effectiveAt: T0 + 2 * 60_000, correctsSeq: null, siteId: "site_hq" }];
    expect(checkTransition(justOut, "OUT", T0 + 2 * 60_000 + 1_000, 60_000, shifts)).toEqual({ ok: false, error: "not_in" });
    expect(checkTransition(justOut, "IN", T0 + 2 * 60_000 + 1_000, 60_000, shifts)).toEqual({ ok: false, error: "too_soon" });
  });
});
