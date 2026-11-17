import { isTestMode } from "./test-mode";

/**
 * Server clock (spec §2.5: time comes from the server only). Tests shift it with
 * POST /api/test/clock; the offset lives on globalThis (spec §7.2), never in a module-level
 * variable, so every route bundle in the dev server sees the same value.
 */
const OFFSET_KEY = Symbol.for("attendance.testClockOffsetMs");

type ClockGlobal = typeof globalThis & { [OFFSET_KEY]?: number };

function offsetMs(): number {
  if (!isTestMode()) return 0;
  const v = (globalThis as ClockGlobal)[OFFSET_KEY];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Current server time in epoch ms (test offset applied only in test mode). */
export function nowMs(): number {
  return Date.now() + offsetMs();
}

/** Current server time as a Date. */
export function now(): Date {
  return new Date(nowMs());
}

/** Test mode only: shift now() by offsetMs. Throws outside test mode. */
export function setTestClockOffset(ms: number): void {
  if (!isTestMode()) throw new Error("setTestClockOffset is test-mode only");
  if (!Number.isFinite(ms)) throw new Error("offset must be a finite number");
  (globalThis as ClockGlobal)[OFFSET_KEY] = ms;
}

/** Test mode only: current offset (0 when unset). */
export function getTestClockOffset(): number {
  return offsetMs();
}
