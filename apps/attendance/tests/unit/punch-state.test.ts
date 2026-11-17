import { describe, expect, it } from "vitest";
import { checkTransition, currentState, nextAction, type StateEvent } from "@/lib/punch-state";

const T0 = Date.parse("2026-11-17T09:00:00.000Z");
const MIN = 60_000;
let seq = 0;
const ev = (kind: StateEvent["kind"], effectiveAt: number, correctsSeq: number | null = null): StateEvent => ({
  seq: ++seq,
  kind,
  effectiveAt,
  correctsSeq,
});

describe("AC-07 transitions", () => {
  it("AC-07 transitions: IN from none or OUT is ok", () => {
    expect(currentState([])).toBe("OUT");
    expect(nextAction([])).toBe("IN");
    expect(checkTransition([], "IN", T0)).toEqual({ ok: true });
    const history = [ev("IN", T0), ev("OUT", T0 + 2 * MIN)];
    expect(currentState(history)).toBe("OUT");
    expect(checkTransition(history, "IN", T0 + 4 * MIN)).toEqual({ ok: true });
  });

  it("AC-07 transitions: IN after IN -> already_in (even within 60 s)", () => {
    const history = [ev("IN", T0)];
    expect(currentState(history)).toBe("IN");
    expect(nextAction(history)).toBe("OUT");
    expect(checkTransition(history, "IN", T0 + 10 * MIN)).toEqual({ ok: false, error: "already_in" });
    expect(checkTransition(history, "IN", T0 + 1_000)).toEqual({ ok: false, error: "already_in" });
  });

  it("AC-07 transitions: OUT from none or OUT -> not_in", () => {
    expect(checkTransition([], "OUT", T0)).toEqual({ ok: false, error: "not_in" });
    const history = [ev("IN", T0), ev("OUT", T0 + 2 * MIN)];
    expect(checkTransition(history, "OUT", T0 + 10 * MIN)).toEqual({ ok: false, error: "not_in" });
  });

  it("AC-07 transitions: < 60 s since the last punch -> too_soon; >= 60 s ok", () => {
    const history = [ev("IN", T0)];
    expect(checkTransition(history, "OUT", T0 + 59_999)).toEqual({ ok: false, error: "too_soon" });
    expect(checkTransition(history, "OUT", T0 + 60_000)).toEqual({ ok: true });
    expect(checkTransition(history, "OUT", T0 + 61_000)).toEqual({ ok: true });
    const back = [ev("IN", T0), ev("OUT", T0 + MIN)];
    expect(checkTransition(back, "IN", T0 + MIN + 30_000)).toEqual({ ok: false, error: "too_soon" });
  });

  it("AC-07 transitions: VOIDed rows are ignored", () => {
    const inRow = ev("IN", T0);
    const voidRow = ev("VOID", T0 + 5_000, inRow.seq);
    const history = [inRow, voidRow];
    expect(currentState(history)).toBe("OUT");
    expect(checkTransition(history, "IN", T0 + 10_000)).toEqual({ ok: true });
    expect(checkTransition(history, "OUT", T0 + 10 * MIN)).toEqual({ ok: false, error: "not_in" });

    const a = ev("IN", T0);
    const b = ev("OUT", T0 + 2 * MIN);
    const vb = ev("VOID", T0 + 3 * MIN, b.seq);
    expect(currentState([a, b, vb])).toBe("IN");
    expect(checkTransition([a, b, vb], "OUT", T0 + 4 * MIN)).toEqual({ ok: true });
    // a VOID that targets a VOID does not resurrect anything
    const vvb = ev("VOID", T0 + 4 * MIN, vb.seq);
    expect(currentState([a, b, vb, vvb])).toBe("IN");
  });

  it("AC-07 transitions: state follows greatest effective_at (admin back-dated rows), not insertion order", () => {
    const punchIn = ev("IN", T0 + 2 * 3_600_000);
    const adminOutEarlier = ev("OUT", T0); // back-dated correction recorded later
    expect(currentState([punchIn, adminOutEarlier])).toBe("IN");
    const adminOutLater = ev("OUT", T0 + 3 * 3_600_000);
    expect(currentState([punchIn, adminOutEarlier, adminOutLater])).toBe("OUT");
  });
});
