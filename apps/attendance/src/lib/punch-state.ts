/**
 * Punch state machine (spec §2.5 step 9, AC-07). Pure.
 * State = kind of the non-voided IN/OUT row with the greatest effective_at (ties: higher seq); none = OUT.
 * A punch needs a valid transition (IN from OUT, OUT from IN) and >= 60 s since the latest non-voided
 * IN/OUT row. The transition is checked first, so a second IN is `already_in` even within 60 s.
 */
export type StateEvent = {
  seq: number;
  kind: "IN" | "OUT" | "VOID";
  effectiveAt: number;
  correctsSeq: number | null;
};

export type PunchKind = "IN" | "OUT";
export type TransitionError = "already_in" | "not_in" | "too_soon";

export const MIN_PUNCH_GAP_MS = 60_000;

/** IN/OUT rows that no VOID row points at. A VOID that targets a VOID has no effect. */
export function liveEvents<T extends StateEvent>(events: readonly T[]): T[] {
  const kindBySeq = new Map(events.map((e) => [e.seq, e.kind]));
  const voided = new Set(
    events
      .filter((e) => e.kind === "VOID" && e.correctsSeq !== null && kindBySeq.get(e.correctsSeq) !== "VOID")
      .map((e) => e.correctsSeq as number),
  );
  return events.filter((e) => e.kind !== "VOID" && !voided.has(e.seq));
}

function latest<T extends StateEvent>(events: readonly T[]): T | null {
  let best: T | null = null;
  for (const e of liveEvents(events)) {
    if (!best || e.effectiveAt > best.effectiveAt || (e.effectiveAt === best.effectiveAt && e.seq > best.seq)) best = e;
  }
  return best;
}

export function currentState(events: readonly StateEvent[]): PunchKind {
  const l = latest(events);
  return l ? (l.kind as PunchKind) : "OUT";
}

/** The one action /punch should offer. */
export function nextAction(events: readonly StateEvent[]): PunchKind {
  return currentState(events) === "IN" ? "OUT" : "IN";
}

export function checkTransition(
  events: readonly StateEvent[],
  requested: PunchKind,
  nowMs: number,
  minGapMs: number = MIN_PUNCH_GAP_MS,
): { ok: true } | { ok: false; error: TransitionError } {
  const state = currentState(events);
  if (requested === "IN" && state === "IN") return { ok: false, error: "already_in" };
  if (requested === "OUT" && state === "OUT") return { ok: false, error: "not_in" };
  const live = liveEvents(events);
  const lastAt = live.reduce((m, e) => Math.max(m, e.effectiveAt), Number.NEGATIVE_INFINITY);
  if (nowMs - lastAt < minGapMs) return { ok: false, error: "too_soon" };
  return { ok: true };
}
