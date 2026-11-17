import type { CDPSession, Page } from "@playwright/test";

/** CDP virtual authenticator (spec §7.1): the phone's platform authenticator, without a human. */
export async function addAuthenticator(page: Page, opts: { uv?: boolean; synced?: boolean } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      // Measured on Playwright's Chromium 159 (decision D-004): an authenticator that HAS user verification but
      // fails it refuses every ceremony, even with userVerification:'discouraged'. A UV=0 signature (AC-18)
      // therefore needs an authenticator without UV; uv:false gives exactly that.
      hasUserVerification: opts.uv ?? true,
      isUserVerified: opts.uv ?? true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: opts.synced ?? false,
      defaultBackupState: opts.synced ?? false,
    },
  });
  return { cdp, authenticatorId };
}

export async function removeAuthenticator(cdp: CDPSession, authenticatorId: string) {
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
}

export async function credentialsOf(cdp: CDPSession, authenticatorId: string) {
  const r = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return r.credentials;
}
