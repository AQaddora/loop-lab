import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { ipAllowed, parseCidr } from "@/lib/ip";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "non-app-error";
  }
  return undefined;
}

describe("AC-03 cidr matching (parseCidr policy)", () => {
  it("AC-03 cidr matching: parseCidr accepts the fixture's documentation ranges and normalises them", () => {
    expect(parseCidr("198.51.100.0/24")).toBe("198.51.100.0/24");
    expect(parseCidr(" 198.51.100.23/24 ")).toBe("198.51.100.0/24");
    expect(parseCidr("2001:db8:10::/48")).toBe("2001:db8:10::/48");
    expect(parseCidr("2001:DB8:10:0::/48")).toBe("2001:db8:10::/48");
    expect(parseCidr("192.0.2.0/24")).toBe("192.0.2.0/24");
    // public unicast
    expect(parseCidr("8.8.8.0/24")).toBe("8.8.8.0/24");
    expect(parseCidr("2a00:1450:4000::/37")).toBe("2a00:1450:4000::/37");
    expect(parseCidr("203.0.113.9/32")).toBe("203.0.113.9/32");
  });

  it("AC-03 cidr matching: parseCidr bad syntax or an IPv4-mapped v6 prefix -> cidr_invalid", () => {
    for (const bad of ["", "198.51.100.0", "198.51.100.0/33", "198.51.100.0/-1", "198.51.100.0/024", "abc/24", "2001:db8::/129", "1.2.3.4/24/5", "999.0.0.0/24", "fe80::%eth0/64", "0x7f.0.0.0/24", "::ffff:198.51.100.0/120", "::ffff:c633:6400/120"]) {
      expect(codeOf(() => parseCidr(bad)), JSON.stringify(bad)).toBe("cidr_invalid");
    }
  });

  it("AC-03 cidr matching: parseCidr /0, v4 < /16, v6 < /32 -> cidr_too_broad", () => {
    for (const broad of ["0.0.0.0/0", "8.0.0.0/8", "198.0.0.0/15", "198.51.0.0/12", "::/0", "2001:db8::/31", "2a00::/16"]) {
      expect(codeOf(() => parseCidr(broad)), broad).toBe("cidr_too_broad");
    }
    expect(parseCidr("198.51.0.0/16")).toBe("198.51.0.0/16");
    expect(parseCidr("2001:db8::/32")).toBe("2001:db8::/32");
  });

  it("AC-03 cidr matching: parseCidr private, loopback, CGNAT, ULA, link-local -> cidr_not_public", () => {
    for (const np of ["10.0.0.0/8", "192.168.1.0/24", "127.0.0.0/8", "100.64.0.0/10", "fd00::/8", "fe80::/10", "172.16.5.0/24", "100.101.102.0/24", "169.254.0.0/16", "224.0.0.0/24", "fd7a:115c:a1e0::/48", "::1/128", "ff02::/16"]) {
      expect(codeOf(() => parseCidr(np)), np).toBe("cidr_not_public");
    }
  });

  it("AC-03 cidr matching: a parsed CIDR works with ipAllowed", () => {
    const cidrs = ["198.51.100.23/24", "2001:db8:10::/48"].map(parseCidr);
    expect(ipAllowed("198.51.100.23", cidrs)).toBe(true);
    expect(ipAllowed("::ffff:198.51.100.23", cidrs)).toBe(true);
    expect(ipAllowed("2001:db8:10::23", cidrs)).toBe(true);
    expect(ipAllowed("203.0.113.9", cidrs)).toBe(false);
  });
});
