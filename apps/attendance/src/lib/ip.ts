/**
 * Client IP + CIDR allowlist (spec §2.2, AC-02, AC-03). Pure functions.
 *
 * The app binds 127.0.0.1 and is reachable only through our proxy, so the client IP comes ONLY from
 * that proxy: TRUSTED_IP_HEADER's single value when set, else the X-Forwarded-For entry
 * TRUSTED_PROXY_HOPS from the right. The leftmost XFF entry is attacker-controlled and never used.
 * In test mode only, x-test-client-ip overrides both.
 */
import ipaddr from "ipaddr.js";
import { AppError } from "./errors";
import { isTestMode } from "./test-mode";

type Env = Record<string, string | undefined>;

export const TEST_IP_HEADER = "x-test-client-ip";

/** Parse one IP strictly: four-part decimal IPv4 or IPv6 (no zone, no port, no brackets). */
function parseIp(raw: string | null | undefined): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "" || s.length > 64) return null;
  try {
    if (ipaddr.IPv4.isValidFourPartDecimal(s)) return ipaddr.IPv4.parse(s);
    if (s.includes(":") && !s.includes("%") && ipaddr.IPv6.isValid(s)) {
      const v6 = ipaddr.IPv6.parse(s);
      // IPv4-mapped IPv6 (::ffff:a.b.c.d) becomes IPv4, like ipaddr.process()
      return v6.isIPv4MappedAddress() ? v6.toIPv4Address() : v6;
    }
  } catch {
    return null;
  }
  return null;
}

/** Normalised string form of an IP, or null if it is not a valid IP. */
export function normaliseIp(raw: string | null | undefined): string | null {
  const ip = parseIp(raw);
  return ip ? ip.toString() : null;
}

/**
 * The request's client IP, normalised (IPv4-mapped IPv6 -> IPv4), or null (-> `ip_unknown`).
 * `env` carries TRUSTED_IP_HEADER / TRUSTED_PROXY_HOPS; test mode is decided by isTestMode() only.
 */
export function clientIp(headers: Headers, env: Env = process.env): string | null {
  if (isTestMode()) {
    const t = headers.get(TEST_IP_HEADER);
    if (t !== null) return normaliseIp(t);
  }

  const trusted = (env.TRUSTED_IP_HEADER ?? "").trim().toLowerCase();
  if (trusted !== "") {
    const v = headers.get(trusted);
    // exactly one value: a list means something upstream appended to it, which we do not trust
    if (v === null || v.includes(",")) return null;
    return normaliseIp(v);
  }

  const hopsRaw = (env.TRUSTED_PROXY_HOPS ?? "1").trim();
  if (!/^[1-9][0-9]?$/.test(hopsRaw)) return null; // misconfigured -> fail closed
  const hops = Number(hopsRaw);
  const xff = headers.get("x-forwarded-for");
  if (xff === null) return null;
  const entries = xff.split(",").map((e) => e.trim());
  if (entries.length < hops) return null;
  return normaliseIp(entries[entries.length - hops]);
}

/**
 * Validate + normalise a CIDR typed by an admin: explicit prefix required, host bits cleared,
 * IPv4-mapped IPv6 ranges (::ffff:a.b.c.d/96+) become IPv4. Throws AppError('cidr_invalid').
 */
export function normaliseCidr(input: string): string {
  if (typeof input !== "string") throw new AppError("cidr_invalid");
  const s = input.trim();
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(s);
  if (!m) throw new AppError("cidr_invalid");
  const ip = m[1];
  const bits = Number(m[2]);
  if (m[2].length > 1 && m[2].startsWith("0")) throw new AppError("cidr_invalid");
  if (ipaddr.IPv4.isValidFourPartDecimal(ip)) {
    if (bits > 32) throw new AppError("cidr_invalid");
    return `${ipaddr.IPv4.networkAddressFromCIDR(`${ip}/${bits}`).toString()}/${bits}`;
  }
  if (ip.includes(":") && !ip.includes("%") && ipaddr.IPv6.isValid(ip)) {
    if (bits > 128) throw new AppError("cidr_invalid");
    const net = ipaddr.IPv6.networkAddressFromCIDR(`${ip}/${bits}`);
    if (net.isIPv4MappedAddress() && bits >= 96) {
      return `${net.toIPv4Address().toString()}/${bits - 96}`;
    }
    return `${net.toString()}/${bits}`;
  }
  throw new AppError("cidr_invalid");
}

/** Is `ip` inside any of `cidrs`? Any invalid CIDR -> AppError('cidr_invalid') (fail closed). */
export function ipAllowed(ip: string | null | undefined, cidrs: readonly string[]): boolean {
  const ranges = cidrs.map((c) => {
    const n = normaliseCidr(c);
    return ipaddr.parseCIDR(n);
  });
  const addr = parseIp(ip);
  if (!addr) return false;
  return ranges.some(([net, bits]) => net.kind() === addr.kind() && addr.match(net, bits));
}
