import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { deployedVersion } from "@/lib/version";

// specs/prod-loop.md PR-04: /api/health reports { ok, version }, version = the image's GIT_SHA (12 chars).
// Without a GIT_SHA (dev, E2E, CI) the body stays exactly {"ok":true}, as AC-01 asserts.

const FULL = "feeb435d88d9a1b2c3d4e5f60718293a4b5c6d7e";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PR-04 health reports the deployed version", () => {
  it("deployedVersion: a full or long sha gives its first 12 hex chars, lowercased", () => {
    expect(deployedVersion({ GIT_SHA: FULL })).toBe("feeb435d88d9");
    expect(deployedVersion({ GIT_SHA: ` ${FULL.toUpperCase()}\n` })).toBe("feeb435d88d9");
    expect(deployedVersion({ GIT_SHA: "feeb435d88d9" })).toBe("feeb435d88d9");
  });

  it("deployedVersion: unset, empty, short or non-hex is no version (fails closed)", () => {
    for (const v of [undefined, "", "   ", "feeb435", "feeb435d88d", "g".repeat(40), `${FULL}0`, "feeb435d88d9; rm -rf /", "main"]) {
      expect(deployedVersion({ GIT_SHA: v }), JSON.stringify(v)).toBeNull();
    }
  });

  it("GET /api/health: with GIT_SHA it is 200 {ok:true, version:<sha12>}", async () => {
    vi.stubEnv("GIT_SHA", FULL);
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "feeb435d88d9" });
  });

  it("GET /api/health: without GIT_SHA it is exactly {ok:true} (AC-01 unchanged)", async () => {
    vi.stubEnv("GIT_SHA", "");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /api/health: reads GIT_SHA per request, never a value cached at import", async () => {
    vi.stubEnv("GIT_SHA", FULL);
    expect((await GET().json()).version).toBe("feeb435d88d9");
    vi.stubEnv("GIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    expect((await GET().json()).version).toBe("0123456789ab");
  });
});
