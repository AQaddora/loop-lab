"use client";
import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";
import { apiSend } from "@/components/api-client";

type Done = { seq: number; kind: string; recordedAt: number };

export default function PunchClient({ base, action }: { base: string; action: "IN" | "OUT" }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);

  async function punch() {
    setBusy(true);
    setError(null);
    try {
      const o = await apiSend<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(base, "POST", "/api/punch/options", { kind: action });
      if (o.status !== 200) return setError(o.body.error ?? "error");
      const response = await startAuthentication({ optionsJSON: o.body.options });
      const r = await apiSend<{ event: Done }>(base, "POST", "/api/punch", { kind: action, response });
      if (r.status !== 201) return setError(r.body.error ?? "error");
      setDone(r.body.event);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "cancelled" : "assertion_invalid");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section data-punched={done.kind} data-seq={done.seq}>
        <h2>{done.kind === "IN" ? "Checked in" : "Checked out"}</h2>
        <p>Server time {new Date(done.recordedAt).toISOString()} · entry #{done.seq}</p>
      </section>
    );
  }
  return (
    <section data-error={error ?? undefined}>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <button type="button" onClick={punch} disabled={busy} data-action={action}>
        {action === "IN" ? "Check in" : "Check out"}
      </button>
    </section>
  );
}
