import { describe, expect, it } from "vitest";
import { mintRotating, mintStatic, verifyScan, type ScanSite, type StaticQrRow } from "@/lib/qr";

const SECRET = "unit-test-qr-signing-secret-0123456789abcdef";
const T0 = Date.parse("2026-11-17T09:00:15.000Z");
const HQ: ScanSite = { id: "site_hq", qrKeyVersion: 1, rotationSeconds: 30, graceWindows: 1, qrMode: "rotating", status: "ACTIVE" };
const WH: ScanSite = { id: "site_wh", qrKeyVersion: 1, rotationSeconds: 30, graceWindows: 1, qrMode: "static", status: "ACTIVE" };
const EXP = Math.floor(T0 / 1000) + 7 * 86_400;
const ROW: StaticQrRow = { id: "sqr_1", siteId: "site_wh", expiresAt: EXP * 1000, status: "ACTIVE" };

const scan = (pathSiteId: string, token: unknown, site: ScanSite | null, row: StaticQrRow | null = ROW, nowMs = T0) =>
  verifyScan({ pathSiteId, token, site, findStatic: (id) => (row && row.id === id ? row : null), secret: SECRET, nowMs });

describe("AC-04 rotating windows (scan verify block)", () => {
  it("AC-04 rotating windows: a valid rotating token for its own site passes, w-1 too", () => {
    expect(scan("site_hq", mintRotating(HQ, SECRET, T0).token, HQ)).toMatchObject({ ok: true, kind: "rotating" });
    expect(scan("site_hq", mintRotating(HQ, SECRET, T0 - 30_000).token, HQ)).toMatchObject({ ok: true });
    expect(scan("site_hq", mintRotating(HQ, SECRET, T0 - 60_000).token, HQ)).toEqual({ ok: false, error: "qr_expired" });
    expect(scan("site_hq", mintRotating(HQ, SECRET, T0 + 30_000).token, HQ)).toEqual({ ok: false, error: "qr_invalid" });
  });

  it("AC-04 rotating windows: a static token on a rotating site -> qr_invalid", () => {
    const staticForHq = mintStatic(HQ, "sqr_1", EXP, SECRET);
    expect(scan("site_hq", staticForHq, HQ, { ...ROW, siteId: "site_hq" })).toEqual({ ok: false, error: "qr_invalid" });
  });

  it("AC-04 rotating windows: path site != token site -> qr_invalid", () => {
    const other: ScanSite = { ...HQ, id: "site_b" };
    const tokenForB = mintRotating(other, SECRET, T0).token;
    expect(scan("site_hq", tokenForB, HQ)).toEqual({ ok: false, error: "qr_invalid" });
    // even if the lookup handed back the token's site for a different path
    expect(scan("site_hq", tokenForB, other)).toEqual({ ok: false, error: "qr_invalid" });
  });

  it("AC-04 rotating windows: unknown site -> qr_invalid; DISABLED site -> qr_revoked (before any token check)", () => {
    const tok = mintRotating(HQ, SECRET, T0).token;
    expect(scan("site_hq", tok, null)).toEqual({ ok: false, error: "qr_invalid" });
    expect(scan("site_hq", tok, { ...HQ, status: "DISABLED" })).toEqual({ ok: false, error: "qr_revoked" });
    expect(scan("site_hq", "garbage", { ...HQ, status: "DISABLED" })).toEqual({ ok: false, error: "qr_revoked" });
    expect(scan("site_hq", tok, { ...HQ, qrKeyVersion: 2 })).toEqual({ ok: false, error: "qr_invalid" });
  });
});

describe("AC-05 static ttl (scan verify block)", () => {
  it("AC-05 static ttl: valid with an ACTIVE row of the same site and exp", () => {
    expect(scan("site_wh", mintStatic(WH, "sqr_1", EXP, SECRET), WH)).toEqual({ ok: true, kind: "static", staticQrId: "sqr_1", expUnix: EXP });
  });

  it("AC-05 static ttl: presented to a rotating site -> qr_invalid", () => {
    const rotatingWh: ScanSite = { ...WH, qrMode: "rotating" };
    expect(scan("site_wh", mintStatic(WH, "sqr_1", EXP, SECRET), rotatingWh)).toEqual({ ok: false, error: "qr_invalid" });
    // and a rotating token on a static site
    expect(scan("site_wh", mintRotating(WH, SECRET, T0).token, WH)).toEqual({ ok: false, error: "qr_invalid" });
  });

  it("AC-05 static ttl: row missing, other site or other exp -> qr_invalid; REVOKED -> qr_revoked; now >= exp -> qr_expired", () => {
    const tok = mintStatic(WH, "sqr_1", EXP, SECRET);
    expect(scan("site_wh", tok, WH, null)).toEqual({ ok: false, error: "qr_invalid" });
    expect(scan("site_wh", tok, WH, { ...ROW, siteId: "site_hq" })).toEqual({ ok: false, error: "qr_invalid" });
    expect(scan("site_wh", tok, WH, { ...ROW, expiresAt: (EXP + 86_400) * 1000 })).toEqual({ ok: false, error: "qr_invalid" });
    expect(scan("site_wh", tok, WH, { ...ROW, status: "REVOKED" })).toEqual({ ok: false, error: "qr_revoked" });
    expect(scan("site_wh", tok, WH, ROW, EXP * 1000)).toEqual({ ok: false, error: "qr_expired" });
    // revoked wins over expired (first failure wins)
    expect(scan("site_wh", tok, WH, { ...ROW, status: "REVOKED" }, EXP * 1000 + 1)).toEqual({ ok: false, error: "qr_revoked" });
  });
});
