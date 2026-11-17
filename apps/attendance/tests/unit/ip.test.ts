import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { clientIp, ipAllowed, normaliseCidr } from "@/lib/ip";

const h = (o: Record<string, string>) => new Headers(o);
const noTrust = { TRUSTED_IP_HEADER: "", TRUSTED_PROXY_HOPS: "1" };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "non-app-error";
  }
  return undefined;
}

afterEach(() => vi.unstubAllEnvs());

describe("AC-02 client ip extraction", () => {
  it("AC-02 client ip extraction: TRUSTED_IP_HEADER wins when set, XFF ignored", () => {
    vi.stubEnv("AUTH_TEST_MODE", "");
    const env = { TRUSTED_IP_HEADER: "x-real-ip", TRUSTED_PROXY_HOPS: "1" };
    expect(clientIp(h({ "x-real-ip": "198.51.100.23", "x-forwarded-for": "203.0.113.9" }), env)).toBe("198.51.100.23");
    // header name is case-insensitive in config
    expect(clientIp(h({ "x-real-ip": "100.101.102.103" }), { TRUSTED_IP_HEADER: "X-Real-IP" })).toBe("100.101.102.103");
    // set but absent -> unknown; never falls back to the forgeable XFF
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.23" }), env)).toBeNull();
    // a list in the trusted header is not a single value
    expect(clientIp(h({ "x-real-ip": "203.0.113.9, 198.51.100.23" }), env)).toBeNull();
  });

  it("AC-02 client ip extraction: XFF entry TRUSTED_PROXY_HOPS from the right; spoofed leftmost ignored", () => {
    vi.stubEnv("AUTH_TEST_MODE", "");
    const spoofed = h({ "x-forwarded-for": "198.51.100.23, 203.0.113.9" });
    expect(clientIp(spoofed, noTrust)).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.23,203.0.113.9 , 10.0.0.1" }), { TRUSTED_PROXY_HOPS: "2" })).toBe(
      "203.0.113.9",
    );
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }), { TRUSTED_PROXY_HOPS: "2" })).toBeNull();
    expect(clientIp(h({}), noTrust)).toBeNull();
    // misconfigured hops fail closed
    for (const hops of ["0", "-1", "abc", "1.5", ""]) {
      expect(clientIp(h({ "x-forwarded-for": "198.51.100.23" }), { TRUSTED_PROXY_HOPS: hops }), hops).toBeNull();
    }
  });

  it("AC-02 client ip extraction: x-test-client-ip ignored outside test mode, honoured in test mode", () => {
    const hdrs = h({ "x-test-client-ip": "198.51.100.23", "x-forwarded-for": "203.0.113.9" });
    vi.stubEnv("AUTH_TEST_MODE", "");
    expect(clientIp(hdrs, noTrust)).toBe("203.0.113.9");
    expect(clientIp(h({ "x-test-client-ip": "198.51.100.23" }), noTrust)).toBeNull();
    vi.stubEnv("AUTH_TEST_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(clientIp(hdrs, noTrust)).toBe("203.0.113.9");
    vi.stubEnv("NODE_ENV", "test");
    expect(clientIp(hdrs, noTrust)).toBe("198.51.100.23");
    expect(clientIp(hdrs, { TRUSTED_IP_HEADER: "x-real-ip" })).toBe("198.51.100.23");
    expect(clientIp(h({ "x-test-client-ip": "garbage" }), noTrust)).toBeNull();
  });

  it("AC-02 client ip extraction: normalises v6 and IPv4-mapped v6; garbage -> null", () => {
    vi.stubEnv("AUTH_TEST_MODE", "");
    const one = (v: string) => clientIp(h({ "x-real-ip": v }), { TRUSTED_IP_HEADER: "x-real-ip" });
    expect(one("::ffff:198.51.100.23")).toBe("198.51.100.23");
    expect(one("2001:DB8:10:0:0:0:0:23")).toBe("2001:db8:10::23");
    expect(one(" 198.51.100.23 ")).toBe("198.51.100.23");
    for (const bad of ["", "not-an-ip", "198.51.100.23:443", "999.1.1.1", "0x7f.0.0.1", "127.1", "[::1]", "fe80::1%eth0", "1.2.3.4/32", "unknown"]) {
      expect(one(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("AC-03 cidr matching", () => {
  const hq = ["198.51.100.0/24", "2001:db8:10::/48"];

  it("AC-03 cidr matching: v4 and v6 inside/outside", () => {
    expect(ipAllowed("198.51.100.23", hq)).toBe(true);
    expect(ipAllowed("2001:db8:10::23", hq)).toBe(true);
    expect(ipAllowed("2001:db8:10:ffff::1", hq)).toBe(true);
    expect(ipAllowed("203.0.113.9", hq)).toBe(false);
    expect(ipAllowed("198.51.101.1", hq)).toBe(false);
    expect(ipAllowed("2001:db8:11::1", hq)).toBe(false);
    expect(ipAllowed("192.0.2.1", ["192.0.2.0/24"])).toBe(true);
  });

  it("AC-03 cidr matching: IPv4-mapped v6 normalised; tailnet ranges work; empty/unknown -> false", () => {
    expect(ipAllowed("::ffff:198.51.100.23", hq)).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.9", hq)).toBe(false);
    expect(ipAllowed("198.51.100.23", ["::ffff:198.51.100.0/120"])).toBe(true);
    expect(ipAllowed("100.101.102.103", ["100.64.0.0/10"])).toBe(true);
    expect(ipAllowed("fd7a:115c:a1e0::1234", ["fd7a:115c:a1e0::/48"])).toBe(true);
    expect(ipAllowed("198.51.100.23", [])).toBe(false);
    expect(ipAllowed(null, hq)).toBe(false);
    expect(ipAllowed("garbage", hq)).toBe(false);
  });

  it("AC-03 cidr matching: invalid CIDR -> cidr_invalid; valid ones normalised", () => {
    expect(normaliseCidr("198.51.100.23/24")).toBe("198.51.100.0/24");
    expect(normaliseCidr(" 2001:DB8:10::/48 ")).toBe("2001:db8:10::/48");
    expect(normaliseCidr("::ffff:198.51.100.0/120")).toBe("198.51.100.0/24");
    expect(normaliseCidr("100.64.0.0/10")).toBe("100.64.0.0/10");
    for (const bad of ["", "198.51.100.0", "198.51.100.0/33", "198.51.100.0/-1", "198.51.100.0/024", "abc/24", "2001:db8::/129", "1.2.3.4/24/5", "999.0.0.0/8", "fe80::%eth0/64", "0x7f.0.0.0/8"]) {
      expect(codeOf(() => normaliseCidr(bad)), JSON.stringify(bad)).toBe("cidr_invalid");
    }
    expect(codeOf(() => ipAllowed("198.51.100.23", ["198.51.100.0/24", "nope"]))).toBe("cidr_invalid");
  });
});
