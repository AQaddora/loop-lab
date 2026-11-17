import { describe, expect, it } from "vitest";
import { restoreBasePath } from "@/lib/base-path";

// Next strips BASE_PATH from the URL a route handler sees; Auth.js needs it back to parse its action.

describe("restoreBasePath (BASE_PATH=/attendance on the tailnet mirror)", () => {
  const H = "https://loop-runner.example.ts.net";

  it("puts the base path back in front of a stripped auth path, keeping the query", () => {
    expect(restoreBasePath(`${H}/api/auth/providers`, "/attendance")).toBe(`${H}/attendance/api/auth/providers`);
    expect(restoreBasePath(`${H}/api/auth/callback/google?code=x&state=y`, "/attendance")).toBe(
      `${H}/attendance/api/auth/callback/google?code=x&state=y`,
    );
  });

  it("is a no-op with an empty base path or when the base path is already there", () => {
    expect(restoreBasePath(`${H}/api/auth/session`, "")).toBe(`${H}/api/auth/session`);
    expect(restoreBasePath(`${H}/attendance/api/auth/session`, "/attendance")).toBe(`${H}/attendance/api/auth/session`);
    expect(restoreBasePath(`${H}/attendance`, "/attendance")).toBe(`${H}/attendance`);
  });

  it("matches the base path as a whole segment, never as a prefix of another one", () => {
    expect(restoreBasePath(`${H}/attendance-x/api/auth/session`, "/attendance")).toBe(
      `${H}/attendance/attendance-x/api/auth/session`,
    );
  });
});
