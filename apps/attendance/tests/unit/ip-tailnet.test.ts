import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { ipAllowed, parseCidrWithEnv as parseCidr, tailnetCidrsAllowed } from "@/lib/ip";

// Holder decision D-003: tailnet staging behind Tailscale Serve sees only 100.64.0.0/10 client IPs,
// so ALLOW_TAILNET_CIDRS=1 lets an admin allowlist those, and nothing else changes.

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "non-app-error";
  }
  return undefined;
}

const ON = { ALLOW_TAILNET_CIDRS: "1" };
const OFF = {};

describe("ALLOW_TAILNET_CIDRS (D-003 tailnet staging)", () => {
  it("is off unless the value is exactly 1", () => {
    expect(tailnetCidrsAllowed(ON)).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", " 1", "1 ", "01"]) {
      expect(tailnetCidrsAllowed({ ALLOW_TAILNET_CIDRS: v }), JSON.stringify(v)).toBe(false);
    }
  });

  it("off: tailnet ranges stay cidr_not_public (the AC-03 policy is unchanged)", () => {
    for (const c of ["100.64.0.0/10", "100.101.102.0/24", "100.90.12.34/32"]) {
      expect(codeOf(() => parseCidr(c, OFF)), c).toBe("cidr_not_public");
      expect(codeOf(() => parseCidr(c, { ALLOW_TAILNET_CIDRS: "true" })), c).toBe("cidr_not_public");
    }
  });

  it("on: any block wholly inside 100.64.0.0/10 is accepted and normalised", () => {
    expect(parseCidr("100.64.0.0/10", ON)).toBe("100.64.0.0/10");
    expect(parseCidr("100.90.12.34/32", ON)).toBe("100.90.12.34/32");
    expect(parseCidr(" 100.101.102.7/24 ", ON)).toBe("100.101.102.0/24");
    expect(parseCidr("100.127.255.255/16", ON)).toBe("100.127.0.0/16");
  });

  it("on: every other non-public range is still rejected", () => {
    for (const np of ["10.0.0.0/8", "192.168.1.0/24", "172.16.5.0/24", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/24", "fd00::/8", "fe80::/10", "fd7a:115c:a1e0::/48", "::1/128"]) {
      expect(codeOf(() => parseCidr(np, ON)), np).toBe("cidr_not_public");
    }
  });

  it("on: a block that only overlaps 100.64.0.0/10 keeps the normal rules", () => {
    // 100.64.0.0/9 normalises to 100.0.0.0/9, which is mostly public space and broader than /16
    expect(codeOf(() => parseCidr("100.64.0.0/9", ON))).toBe("cidr_too_broad");
    expect(codeOf(() => parseCidr("100.0.0.0/8", ON))).toBe("cidr_too_broad");
    expect(codeOf(() => parseCidr("0.0.0.0/0", ON))).toBe("cidr_too_broad");
    // just outside the tailnet block on either side: ordinary public ranges, ordinary rules
    expect(parseCidr("100.63.255.0/24", ON)).toBe("100.63.255.0/24");
    expect(parseCidr("100.128.0.0/24", ON)).toBe("100.128.0.0/24");
  });

  it("on: public ranges and bad syntax behave exactly as without the flag", () => {
    expect(parseCidr("198.51.100.23/24", ON)).toBe("198.51.100.0/24");
    expect(parseCidr("2001:db8:10::/48", ON)).toBe("2001:db8:10::/48");
    for (const bad of ["100.64.0.0", "100.64.0.0/33", "100.64.0.0/010", "::ffff:100.64.0.0/106"]) {
      expect(codeOf(() => parseCidr(bad, ON)), bad).toBe("cidr_invalid");
    }
  });

  it("on: an accepted tailnet CIDR matches tailnet clients and nobody else", () => {
    const cidrs = [parseCidr("100.64.0.0/10", ON)];
    expect(ipAllowed("100.90.12.34", cidrs)).toBe(true);
    expect(ipAllowed("::ffff:100.90.12.34", cidrs)).toBe(true);
    expect(ipAllowed("100.128.0.1", cidrs)).toBe(false);
    expect(ipAllowed("10.0.0.1", cidrs)).toBe(false);
    expect(ipAllowed("203.0.113.9", cidrs)).toBe(false);
  });
});
