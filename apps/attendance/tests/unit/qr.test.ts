import { describe, expect, it } from "vitest";
import { mintRotating, mintStatic, verifyQrToken, windowAt, type QrSite } from "@/lib/qr";

const SECRET = "unit-test-qr-signing-secret-0123456789abcdef";
const HQ: QrSite = { id: "site_hq", qrKeyVersion: 1, rotationSeconds: 30, graceWindows: 1 };
const WH: QrSite = { id: "site_wh", qrKeyVersion: 1, rotationSeconds: 30, graceWindows: 1 };
const T0 = Date.parse("2026-11-17T09:00:00.000Z"); // window boundary (divisible by 30 s)
const W = 30_000;

function flipLastChar(s: string) {
  const c = s.at(-1) === "A" ? "B" : "A";
  return s.slice(0, -1) + c;
}

describe("AC-04 rotating windows", () => {
  it("AC-04 rotating windows: accepted in w and w-1", () => {
    const { token, window } = mintRotating(HQ, SECRET, T0 + 5_000);
    expect(window).toBe(windowAt(T0, 30));
    expect(verifyQrToken(token, HQ, SECRET, T0 + 5_000)).toEqual({ ok: true, kind: "rotating", window });
    expect(verifyQrToken(token, HQ, SECRET, T0 + W + 29_999)).toEqual({ ok: true, kind: "rotating", window });
  });

  it("AC-04 rotating windows: w-2 -> qr_expired", () => {
    const { token, expiresAtMs } = mintRotating(HQ, SECRET, T0);
    expect(expiresAtMs).toBe(T0 + 2 * W);
    expect(verifyQrToken(token, HQ, SECRET, T0 + 2 * W)).toEqual({ ok: false, error: "qr_expired" });
    expect(verifyQrToken(token, HQ, SECRET, T0 + 10 * W)).toEqual({ ok: false, error: "qr_expired" });
  });

  it("AC-04 rotating windows: w+1 (future), wrong site, bad signature, old key version -> qr_invalid", () => {
    const future = mintRotating(HQ, SECRET, T0 + W).token;
    expect(verifyQrToken(future, HQ, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });

    const hqToken = mintRotating(HQ, SECRET, T0).token;
    expect(verifyQrToken(hqToken, WH, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    expect(verifyQrToken(flipLastChar(hqToken), HQ, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    expect(verifyQrToken(hqToken, HQ, "another-secret-another-secret-another-secret", T0)).toEqual({
      ok: false,
      error: "qr_invalid",
    });

    // key version bumped (revocation): old tokens die
    expect(verifyQrToken(hqToken, { ...HQ, qrKeyVersion: 2 }, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });

    // a forged token for an old window is invalid, not merely expired
    const [r, s, kv, w] = hqToken.split(".");
    const forgedOld = [r, s, kv, String(Number(w) - 5), hqToken.split(".")[4]].join(".");
    expect(verifyQrToken(forgedOld, HQ, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    // rewriting the window to "now" without re-signing is invalid
    const old = mintRotating(HQ, SECRET, T0 - 5 * W).token.split(".");
    expect(verifyQrToken([old[0], old[1], old[2], w, old[4]].join("."), HQ, SECRET, T0)).toEqual({
      ok: false,
      error: "qr_invalid",
    });
  });

  it("AC-04 rotating windows: any parse error -> qr_invalid", () => {
    const tok = mintRotating(HQ, SECRET, T0).token;
    const [r, s, kv, w, sig] = tok.split(".");
    const bad = [
      "",
      "x",
      "r.site_hq.1",
      `${r}.${s}.${kv}.${w}`,
      `${r}.${s}.${kv}.${w}.${sig}.extra`,
      `${r}.${s}.${kv}.0${w}.${sig}`,
      `${r}.${s}.01.${w}.${sig}`,
      `${r}.${s}.${kv}.-${w}.${sig}`,
      `${r}.${s}.${kv}.${w}.${sig}=`,
      `${r}.${s}.${kv}.${w}.${sig.slice(0, -1)}`,
      `q.${s}.${kv}.${w}.${sig}`,
      `${r}.site.hq.${kv}.${w}.${sig}`,
      tok.toUpperCase(),
    ];
    for (const b of bad) expect(verifyQrToken(b, HQ, SECRET, T0), b).toEqual({ ok: false, error: "qr_invalid" });
    for (const b of [undefined, null, 42, {}, "r".repeat(1000)]) {
      expect(verifyQrToken(b, HQ, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    }
  });

  it("AC-04 rotating windows: grace and rotation come from the site", () => {
    const strict = { ...HQ, graceWindows: 0 };
    const { token } = mintRotating(strict, SECRET, T0);
    expect(verifyQrToken(token, strict, SECRET, T0 + W - 1).ok).toBe(true);
    expect(verifyQrToken(token, strict, SECRET, T0 + W)).toEqual({ ok: false, error: "qr_expired" });
  });
});

describe("AC-05 static ttl", () => {
  const exp = Math.floor((T0 + 7 * 24 * 3600 * 1000) / 1000);

  it("AC-05 static ttl: valid before exp", () => {
    const tok = mintStatic(WH, "sqr_1", exp, SECRET);
    expect(tok.startsWith("s.site_wh.1.sqr_1.")).toBe(true);
    expect(verifyQrToken(tok, WH, SECRET, T0)).toEqual({ ok: true, kind: "static", staticQrId: "sqr_1", expUnix: exp });
    expect(verifyQrToken(tok, WH, SECRET, exp * 1000 - 1).ok).toBe(true);
  });

  it("AC-05 static ttl: qr_expired at/after exp", () => {
    const tok = mintStatic(WH, "sqr_1", exp, SECRET);
    expect(verifyQrToken(tok, WH, SECRET, exp * 1000)).toEqual({ ok: false, error: "qr_expired" });
    expect(verifyQrToken(tok, WH, SECRET, exp * 1000 + 86_400_000)).toEqual({ ok: false, error: "qr_expired" });
  });

  it("AC-05 static ttl: qr_invalid if tampered", () => {
    const tok = mintStatic(WH, "sqr_1", exp, SECRET);
    const p = tok.split(".");
    const extended = [p[0], p[1], p[2], p[3], String(exp + 365 * 86400), p[5]].join(".");
    expect(verifyQrToken(extended, WH, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    const otherId = [p[0], p[1], p[2], "sqr_2", p[4], p[5]].join(".");
    expect(verifyQrToken(otherId, WH, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    expect(verifyQrToken(flipLastChar(tok), WH, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    expect(verifyQrToken(tok, HQ, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    expect(verifyQrToken(tok, { ...WH, qrKeyVersion: 2 }, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
    // tampered AND expired is still qr_invalid (signature first)
    const expiredTampered = [p[0], p[1], p[2], p[3], String(1), p[5]].join(".");
    expect(verifyQrToken(expiredTampered, WH, SECRET, T0)).toEqual({ ok: false, error: "qr_invalid" });
  });

  it("refuses a short signing secret", () => {
    expect(() => mintRotating(HQ, "short", T0)).toThrow();
  });
});
