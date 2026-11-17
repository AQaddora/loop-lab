/**
 * QR tokens (spec §2.1, AC-04, AC-05). Pure functions; clock and secret are injected.
 *
 *   K_site   = HMAC-SHA256(QR_SIGNING_SECRET, "qr:" + siteId + ":" + qr_key_version)
 *   rotating = "r." + siteId + "." + kv + "." + window + "." + b64url(HMAC(K_site, "r|siteId|kv|window"))
 *              window = floor(nowMs / 1000 / rotation_seconds); accept w_now - grace .. w_now; future -> qr_invalid
 *   static   = "s." + siteId + "." + kv + "." + staticQrId + "." + expUnix + "." + b64url(HMAC(K_site, "s|siteId|kv|id|exp"))
 *              (the DB row must also be ACTIVE: checked by the scan route, not here)
 * Signatures are compared with crypto.timingSafeEqual. Any parse error -> qr_invalid.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type QrSite = {
  id: string;
  qrKeyVersion: number;
  rotationSeconds: number;
  graceWindows: number;
};

export type QrError = "qr_invalid" | "qr_expired";

export type RotatingOk = { ok: true; kind: "rotating"; window: number };
export type StaticOk = { ok: true; kind: "static"; staticQrId: string; expUnix: number };
export type QrFail = { ok: false; error: QrError };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const INT_RE = /^(0|[1-9][0-9]{0,14})$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

export function assertQrSecret(secret: string | undefined): string {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("QR_SIGNING_SECRET must be set to 32+ bytes");
  }
  return secret;
}

function siteKey(secret: string, siteId: string, kv: number): Buffer {
  return createHmac("sha256", assertQrSecret(secret)).update(`qr:${siteId}:${kv}`).digest();
}

function sign(key: Buffer, msg: string): string {
  return createHmac("sha256", key).update(msg).digest("base64url");
}

function sigEqual(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "ascii");
  const b = Buffer.from(given, "ascii");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function windowAt(nowMs: number, rotationSeconds: number): number {
  return Math.floor(nowMs / 1000 / rotationSeconds);
}

function checkSite(site: QrSite) {
  if (!ID_RE.test(site.id)) throw new Error("bad site id");
  if (!Number.isInteger(site.qrKeyVersion) || site.qrKeyVersion < 1) throw new Error("bad key version");
  if (!Number.isInteger(site.rotationSeconds) || site.rotationSeconds < 1) throw new Error("bad rotation");
  if (!Number.isInteger(site.graceWindows) || site.graceWindows < 0) throw new Error("bad grace");
}

/** Mint the rotating token for the window containing nowMs. expiresAtMs = end of its last valid window. */
export function mintRotating(site: QrSite, secret: string, nowMs: number) {
  checkSite(site);
  const window = windowAt(nowMs, site.rotationSeconds);
  const kv = site.qrKeyVersion;
  const sig = sign(siteKey(secret, site.id, kv), `r|${site.id}|${kv}|${window}`);
  const expiresAtMs = (window + 1 + site.graceWindows) * site.rotationSeconds * 1000;
  return { token: `r.${site.id}.${kv}.${window}.${sig}`, window, expiresAtMs };
}

export function mintStatic(site: QrSite, staticQrId: string, expUnix: number, secret: string): string {
  checkSite(site);
  if (!ID_RE.test(staticQrId)) throw new Error("bad static qr id");
  if (!Number.isInteger(expUnix) || expUnix < 0) throw new Error("bad exp");
  const kv = site.qrKeyVersion;
  const sig = sign(siteKey(secret, site.id, kv), `s|${site.id}|${kv}|${staticQrId}|${expUnix}`);
  return `s.${site.id}.${kv}.${staticQrId}.${expUnix}.${sig}`;
}

/**
 * Verify a token against the site it was scanned for (`site` comes from the DB row of the URL's siteId).
 * Check order: parse -> site -> key version -> signature -> time. A forged or tampered token is
 * qr_invalid even when it would also be expired.
 */
export function verifyQrToken(token: unknown, site: QrSite, secret: string, nowMs: number): RotatingOk | StaticOk | QrFail {
  const invalid: QrFail = { ok: false, error: "qr_invalid" };
  if (typeof token !== "string" || token.length > 256) return invalid;
  checkSite(site);
  const parts = token.split(".");
  const kind = parts[0];

  if (kind === "r" && parts.length === 5) {
    const [, siteId, kvS, wS, sig] = parts;
    if (!ID_RE.test(siteId) || !INT_RE.test(kvS) || !INT_RE.test(wS) || !SIG_RE.test(sig)) return invalid;
    if (siteId !== site.id || Number(kvS) !== site.qrKeyVersion) return invalid;
    const w = Number(wS);
    const expected = sign(siteKey(secret, site.id, site.qrKeyVersion), `r|${site.id}|${site.qrKeyVersion}|${w}`);
    if (!sigEqual(expected, sig)) return invalid;
    const wNow = windowAt(nowMs, site.rotationSeconds);
    if (w > wNow) return invalid; // from the future
    if (w < wNow - site.graceWindows) return { ok: false, error: "qr_expired" };
    return { ok: true, kind: "rotating", window: w };
  }

  if (kind === "s" && parts.length === 6) {
    const [, siteId, kvS, qrId, expS, sig] = parts;
    if (!ID_RE.test(siteId) || !INT_RE.test(kvS) || !ID_RE.test(qrId) || !INT_RE.test(expS) || !SIG_RE.test(sig)) {
      return invalid;
    }
    if (siteId !== site.id || Number(kvS) !== site.qrKeyVersion) return invalid;
    const exp = Number(expS);
    const expected = sign(
      siteKey(secret, site.id, site.qrKeyVersion),
      `s|${site.id}|${site.qrKeyVersion}|${qrId}|${exp}`,
    );
    if (!sigEqual(expected, sig)) return invalid;
    if (!(nowMs < exp * 1000)) return { ok: false, error: "qr_expired" };
    return { ok: true, kind: "static", staticQrId: qrId, expUnix: exp };
  }

  return invalid;
}
