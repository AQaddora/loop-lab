import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestClockOffset, now, nowMs, setTestClockOffset } from "@/lib/clock";

const KEY = Symbol.for("attendance.testClockOffsetMs");

describe("server clock", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[KEY];
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
});
