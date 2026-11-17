import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestClockOffset, now, nowMs, setTestClock, setTestClockOffset } from "@/lib/clock";

const KEY = Symbol.for("attendance.testClockOffsetMs");
const FIXED = Symbol.for("attendance.testClockFixedMs");

describe("server clock", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[KEY];
    delete (globalThis as Record<symbol, unknown>)[FIXED];
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("applies the test offset only in test mode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubEnv("AUTH_TEST_MODE", "1");
    setTestClockOffset(61_000);
    expect(nowMs()).toBe(Date.parse("2026-01-01T00:01:01.000Z"));
    expect(now().toISOString()).toBe("2026-01-01T00:01:01.000Z");
    expect(getTestClockOffset()).toBe(61_000);
    // the offset lives on globalThis, not in a module variable
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBe(61_000);

    vi.stubEnv("AUTH_TEST_MODE", "");
    expect(nowMs()).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("refuses to set an offset outside test mode", () => {
    vi.stubEnv("AUTH_TEST_MODE", "");
    expect(() => setTestClockOffset(1000)).toThrow();
    vi.stubEnv("AUTH_TEST_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setTestClockOffset(1000)).toThrow();
  });

  it("ignores a planted offset outside test mode", () => {
    (globalThis as Record<symbol, unknown>)[KEY] = 10_000_000;
    vi.stubEnv("AUTH_TEST_MODE", "");
    const t = Date.now();
    expect(Math.abs(nowMs() - t)).toBeLessThan(1000);
  });

  it("freezes with fixedMs, shifts with offsetMs, clears with {} (test mode only)", () => {
    vi.stubEnv("AUTH_TEST_MODE", "1");
    const fixed = Date.parse("2026-11-17T09:00:15.000Z");
    setTestClock({ fixedMs: fixed });
    expect(nowMs()).toBe(fixed);
    expect(nowMs()).toBe(fixed);
    setTestClock({ offsetMs: -3_600_000 });
    expect(Math.abs(nowMs() - (Date.now() - 3_600_000))).toBeLessThan(1000);
    setTestClock({});
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
    expect(() => setTestClock({ offsetMs: 1, fixedMs: 2 })).toThrow();
    // a frozen clock planted outside test mode is ignored
    setTestClock({ fixedMs: 1 });
    vi.stubEnv("AUTH_TEST_MODE", "");
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
    expect(() => setTestClock({})).toThrow();
  });
});
