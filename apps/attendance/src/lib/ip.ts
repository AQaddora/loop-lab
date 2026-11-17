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

/** ipaddr.js range() names that are never an office's public egress (spec §2.2). */
const NON_PUBLIC = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "carrierGradeNat",
  "uniqueLocal",
]);

/** Tailscale's tailnet IPv4 block (CGNAT space). Only reachable through parseCidr's ALLOW_TAILNET_CIDRS branch. */
const TAILNET_V4 = ipaddr.IPv4.parse("100.64.0.0");
const TAILNET_V4_BITS = 10;

/** ALLOW_TAILNET_CIDRS must be exactly "1"; anything else (unset, "true", " 1") keeps the strict policy. */
export function tailnetCidrsAllowed(env: Env = process.env): boolean {
  return env.ALLOW_TAILNET_CIDRS === "1";
}

function lastAddress(net: ipaddr.IPv4 | ipaddr.IPv6, bits: number): ipaddr.IPv4 | ipaddr.IPv6 {
  const cidr = `${net.toString()}/${bits}`;
  return net.kind() === "ipv4" ? ipaddr.IPv4.broadcastAddressFromCIDR(cidr) : ipaddr.IPv6.broadcastAddressFromCIDR(cidr);
}

/**
 * The admin-input CIDR rules (spec §2.2, AC-03). Returns the normalised CIDR or throws AppError:
 *   cidr_invalid    syntax error, no prefix, or an IPv4-mapped IPv6 prefix
 *   cidr_not_public the whole block lies in one non-public range (private, loopback, CGNAT, ULA, link-local, …)
 *   cidr_too_broad  IPv4 shorter than /16 or IPv6 shorter than /32 (incl. /0)
 *   cidr_not_public a network address whose range() is non-public
 * Documentation ranges (range "reserved": 198.51.100.0/24, 2001:db8::/32) are accepted.
 * The "whole block" test runs first so 10.0.0.0/8 reads as not public while /0 reads as too broad (AC-03).
 *
 * Tailnet staging only (holder decision D-003): with ALLOW_TAILNET_CIDRS=1, a block that lies wholly inside
 * Tailscale's 100.64.0.0/10 (prefix /10 or longer) is accepted, because behind Tailscale Serve every caller
 * arrives with a tailnet IP. Every other non-public range, and anything that only overlaps 100.64.0.0/10,
 * keeps the rules above. Unset (or any value but "1") in production.
 *
 * One argument only, so `cidrs.map(parseCidr)` stays safe; parseCidrWithEnv() takes an explicit env.
 */
export function parseCidr(input: string): string {
  return parseCidrWithEnv(input, process.env);
}

/** parseCidr() with an explicit env (ALLOW_TAILNET_CIDRS). */
export function parseCidrWithEnv(input: string, env: Env): string {
  if (typeof input !== "string") throw new AppError("cidr_invalid");
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(input.trim());
  if (!m) throw new AppError("cidr_invalid");
  if (m[2].length > 1 && m[2].startsWith("0")) throw new AppError("cidr_invalid");
  const bits = Number(m[2]);
  let net: ipaddr.IPv4 | ipaddr.IPv6;
  if (ipaddr.IPv4.isValidFourPartDecimal(m[1])) {
    if (bits > 32) throw new AppError("cidr_invalid");
    net = ipaddr.IPv4.networkAddressFromCIDR(`${m[1]}/${bits}`);
  } else if (m[1].includes(":") && !m[1].includes("%") && ipaddr.IPv6.isValid(m[1])) {
    if (bits > 128) throw new AppError("cidr_invalid");
    if (ipaddr.IPv6.parse(m[1]).isIPv4MappedAddress()) throw new AppError("cidr_invalid");
    net = ipaddr.IPv6.networkAddressFromCIDR(`${m[1]}/${bits}`);
  } else {
    throw new AppError("cidr_invalid");
  }
  if (tailnetCidrsAllowed(env) && net.kind() === "ipv4" && bits >= TAILNET_V4_BITS && (net as ipaddr.IPv4).match(TAILNET_V4, TAILNET_V4_BITS)) {
    return `${net.toString()}/${bits}`;
  }
  const first = net.range();
  const last = lastAddress(net, bits).range();
  if (first === last && NON_PUBLIC.has(first)) throw new AppError("cidr_not_public");
  if ((net.kind() === "ipv4" && bits < 16) || (net.kind() === "ipv6" && bits < 32)) throw new AppError("cidr_too_broad");
  if (NON_PUBLIC.has(first)) throw new AppError("cidr_not_public");
  return `${net.toString()}/${bits}`;
}
