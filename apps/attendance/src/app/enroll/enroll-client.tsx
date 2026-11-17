"use client";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { apiSend } from "@/components/api-client";

type Props = { base: string; initialPendingCode: string | null; hasTicket: boolean; siteName: string | null };

export default function EnrollClient({ base, initialPendingCode, hasTicket, siteName }: Props) {
  const [code, setCode] = useState<string | null>(initialPendingCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const o = await apiSend<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(base, "POST", "/api/webauthn/register/options", {});
      if (o.status !== 200) return setError(o.body.error ?? "error");
      const response = await startRegistration({ optionsJSON: o.body.options });
      const v = await apiSend<{ confirmCode: string }>(base, "POST", "/api/webauthn/register/verify", { response });
      if (v.status !== 201) return setError(v.body.error ?? "error");
      setCode(v.body.confirmCode);
      setAgain(false);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "cancelled" : "assertion_invalid");
    } finally {
      setBusy(false);
    }
  }

  if (code && !again) {
    return (
      <section data-waiting>
        <h2>Waiting for admin approval</h2>
        <p>Show this code to your admin, in person:</p>
        <p style={{ fontSize: "2.5rem", letterSpacing: "0.3rem", fontFamily: "monospace" }} data-confirm-code={code}>
          {code}
        </p>
        <p className="muted">Once approved, scan the QR again to check in.</p>
        <button type="button" onClick={() => setAgain(true)}>Register a different passkey</button>
      </section>
    );
  }
  return (
    <section data-error={error ?? undefined}>
      {hasTicket ? <p className="muted">Site: {siteName}</p> : <p className="error">Scan the QR at the entrance first (on the office Wi-Fi).</p>}
      <p>Your phone will ask for your fingerprint, Face ID or screen lock. The server never sees your fingerprint.</p>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <button type="button" onClick={register} disabled={busy}>Register fingerprint / Face ID</button>
    </section>
  );
}
