import type { Page } from "@playwright/test";

/**
 * Drives the WebAuthn API from the page (spec §7.1), for flows and abuse cases the UI hides:
 * fetch options -> optional mutation -> parse*FromJSON -> navigator.credentials.* -> toJSON() -> POST.
 * Same-origin fetch from the page sends the Origin header. Returns {status, body} plus what was sent.
 */
export type CeremonyResult = { status: number; body: Record<string, unknown> & { error?: string }; sent?: unknown; optionsStatus?: number };

export async function register(page: Page, opts: { uv?: "discouraged" | "preferred" } = {}): Promise<CeremonyResult> {
  return page.evaluate(async ({ uv }) => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      let b: Record<string, unknown> = {};
      try {
        b = await r.json();
      } catch {
        /* no body */
      }
      return { status: r.status, body: b };
    };
    const o = await post("/api/webauthn/register/options", {});
    if (o.status !== 200) return { ...o, optionsStatus: o.status };
    const options = (o.body as { options: Record<string, unknown> & { authenticatorSelection: Record<string, unknown> } }).options;
    // AC-18: Chrome refuses a UV-required ceremony client-side when the authenticator cannot verify, so the
    // override makes the authenticator sign with UV=0 and the SERVER has to answer uv_required. Chrome also
    // refuses a discoverable credential without UV, so the override relaxes residentKey on the client too;
    // the server's options and checks are untouched.
    if (uv) {
      options.authenticatorSelection.userVerification = uv;
      options.authenticatorSelection.residentKey = "discouraged";
      options.authenticatorSelection.requireResidentKey = false;
    }
    const PKC = PublicKeyCredential as unknown as { parseCreationOptionsFromJSON(o: unknown): PublicKeyCredentialCreationOptions };
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.create({ publicKey: PKC.parseCreationOptionsFromJSON(options) });
    } catch (e) {
      return { status: 0, body: { error: `client:${(e as Error).name}` }, optionsStatus: 200 };
    }
    const sent = { response: (cred as unknown as { toJSON(): unknown }).toJSON() };
    const v = await post("/api/webauthn/register/verify", sent);
    return { ...v, sent, optionsStatus: 200 };
  }, { uv: opts.uv ?? null });
}

/** POST a previously sent verify body again (replay). */
export async function postFromPage(page: Page, path: string, body: unknown): Promise<CeremonyResult> {
  return page.evaluate(async ({ path, body }) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let b: Record<string, unknown> = {};
    try {
      b = await r.json();
    } catch {
      /* no body */
    }
    return { status: r.status, body: b };
  }, { path, body });
}

/**
 * Punch from the page: options {kind} -> parseRequestOptionsFromJSON -> navigator.credentials.get -> POST /api/punch.
 * `postKind` posts a different kind than the options were fetched for (AC-23); `extra` adds body fields (AC-27).
 */
export async function punch(
  page: Page,
  kind: "IN" | "OUT",
  opts: { postKind?: "IN" | "OUT"; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<CeremonyResult> {
  return page.evaluate(async ({ kind, postKind, extra, headers }) => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      let b: Record<string, unknown> = {};
      try {
        b = await r.json();
      } catch {
        /* no body */
      }
      return { status: r.status, body: b };
    };
    const o = await post("/api/punch/options", { kind });
    if (o.status !== 200) return { ...o, optionsStatus: o.status };
    const PKC = PublicKeyCredential as unknown as { parseRequestOptionsFromJSON(o: unknown): PublicKeyCredentialRequestOptions };
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.get({ publicKey: PKC.parseRequestOptionsFromJSON((o.body as { options: unknown }).options) });
    } catch (e) {
      return { status: 0, body: { error: `client:${(e as Error).name}` }, optionsStatus: 200 };
    }
    const sent = { kind: postKind ?? kind, response: (cred as unknown as { toJSON(): unknown }).toJSON(), ...extra };
    const v = await post("/api/punch", sent);
    return { ...v, sent, optionsStatus: 200 };
  }, { kind, postKind: opts.postKind ?? null, extra: opts.extra ?? {}, headers: opts.headers ?? {} });
}
