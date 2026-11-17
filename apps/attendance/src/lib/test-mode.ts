/**
 * The ONE test switch (spec §7.2). Every test-only surface (test-login provider, x-test-client-ip,
 * /api/test/*, clock offset) must be gated by this function, and nothing else in src/ may read
 * AUTH_TEST_MODE (AC-08; src/instrumentation.ts is the only other reader, for the boot guard).
 *
 * `next build` inlines NODE_ENV='production', so in every prod bundle this is `false && …`:
 * test mode is dead code there, whatever AUTH_TEST_MODE says at runtime.
 */
export function isTestMode(): boolean {
  return process.env.AUTH_TEST_MODE === "1" && process.env.NODE_ENV !== "production";
}
