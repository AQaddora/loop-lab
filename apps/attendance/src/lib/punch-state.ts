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
  /** the row's site; its max_shift_hours decides when an open IN goes stale */
  siteId?: string | null;
};

export const DEFAULT_MAX_SHIFT_HOURS = 16;

/**
 * Stale-IN rule (spec §2.5): an IN older than its site's max_shift_hours counts as OUT for the state,
 * so a forgotten check-out never blocks the next day's check-in. The IN stays open in reports (OD-9).
 */
export type StaleRule = { nowMs: number; maxShiftHours: (siteId: string | null) => number };

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

function isStaleIn(e: StateEvent, stale: StaleRule | undefined): boolean {
  if (!stale || e.kind !== "IN") return false;
  const h = stale.maxShiftHours(e.siteId ?? null);
  const hours = Number.isFinite(h) && h > 0 ? h : DEFAULT_MAX_SHIFT_HOURS;
  return stale.nowMs - e.effectiveAt > hours * 3_600_000;
}

export function currentState(events: readonly StateEvent[], stale?: StaleRule): PunchKind {
  const l = latest(events);
  if (!l || isStaleIn(l, stale)) return "OUT";
  return l.kind as PunchKind;
}

/** The one action /punch should offer. */
export function nextAction(events: readonly StateEvent[], stale?: StaleRule): PunchKind {
  return currentState(events, stale) === "IN" ? "OUT" : "IN";
}

export function checkTransition(
  events: readonly StateEvent[],
  requested: PunchKind,
  nowMs: number,
  minGapMs: number = MIN_PUNCH_GAP_MS,
  maxShiftHours?: (siteId: string | null) => number,
): { ok: true } | { ok: false; error: TransitionError } {
  const state = currentState(events, maxShiftHours ? { nowMs, maxShiftHours } : undefined);
  if (requested === "IN" && state === "IN") return { ok: false, error: "already_in" };
  if (requested === "OUT" && state === "OUT") return { ok: false, error: "not_in" };
  const live = liveEvents(events);
  const lastAt = live.reduce((m, e) => Math.max(m, e.effectiveAt), Number.NEGATIVE_INFINITY);
  if (nowMs - lastAt < minGapMs) return { ok: false, error: "too_soon" };
  return { ok: true };
}
