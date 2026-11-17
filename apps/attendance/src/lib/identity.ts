/**
 * Identity claims (spec §2.3): both providers are normalised to one Claims shape before the policy runs.
 * Google: from the ID-token `profile`. test-login (test mode only): from its authorize() result.
 */
export type Claims = {
  sub: string;
  email: string;
  email_verified: boolean;
  hd: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Strict: email_verified is true only for a real boolean true; missing pieces become "" / null. */
export function claimsFromGoogle(profile: Record<string, unknown> | null | undefined): Claims | null {
  if (!profile) return null;
  const sub = str(profile.sub);
  const email = str(profile.email).trim().toLowerCase();
  if (sub === "" || email === "") return null;
  const hd = str(profile.hd).trim().toLowerCase();
  return { sub, email, email_verified: profile.email_verified === true, hd: hd === "" ? null : hd };
}

/** `hd` the way Google reports it: the email domain, except for consumer gmail.com accounts. */
export function hdForEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain === "" || domain === "gmail.com" || domain === "googlemail.com" ? null : domain;
}

/** test-login: `{email, sub?, emailVerified?=true}`; hd mirrors Google. */
export function claimsFromTestLogin(input: { email?: unknown; sub?: unknown; emailVerified?: unknown }): Claims | null {
  const email = str(input.email).trim().toLowerCase();
  if (email === "") return null;
  const sub = str(input.sub) !== "" ? str(input.sub) : `test-sub:${email}`;
  const ev = input.emailVerified;
  const email_verified = !(ev === false || ev === "false" || ev === "0");
  return { sub, email, email_verified, hd: hdForEmail(email) };
}
