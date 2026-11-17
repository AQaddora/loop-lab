"use client";
import { useCallback, useEffect, useState } from "react";
import { apiSend } from "@/components/api-client";

type Item = {
  id: string; status: string; createdAt: number; regIp: string | null; regUa: string | null; regSiteName: string | null;
  aaguid: string | null; synced: boolean; member: { id: string; email: string; fullName: string | null };
};

export default function CredentialsClient({ base, meId }: { base: string; meId: string }) {
  const [pending, setPending] = useState<Item[]>([]);
  const [approved, setApproved] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchQueues = useCallback(async () => {
    const [p, a] = await Promise.all([
      apiSend<{ credentials: Item[] }>(base, "GET", "/api/admin/credentials?status=PENDING"),
      apiSend<{ credentials: Item[] }>(base, "GET", "/api/admin/credentials?status=APPROVED"),
    ]);
    return { pending: p.body.credentials ?? [], approved: a.body.credentials ?? [] };
  }, [base]);
  const load = useCallback(async () => {
    const q = await fetchQueues();
    setPending(q.pending);
    setApproved(q.approved);
  }, [fetchQueues]);
  useEffect(() => {
    let alive = true;
    fetchQueues().then((q) => {
      if (!alive) return;
      setPending(q.pending);
      setApproved(q.approved);
    });
    return () => {
      alive = false;
    };
  }, [fetchQueues]);

  async function act(id: string, decision: "approve" | "reject" | "revoke", confirmCode?: string) {
    const r = await apiSend(base, "POST", `/api/admin/credentials/${id}/${decision}`, confirmCode ? { confirmCode } : {});
    setError(r.status === 200 ? null : (r.body.error ?? "error"));
    await load();
  }

  return (
    <div data-error={error ?? undefined}>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <h2>Pending</h2>
      <table>
        <thead><tr><th>Member</th><th>Site</th><th>IP</th><th>Device</th><th>Synced</th><th>Time</th><th /></tr></thead>
        <tbody>
          {pending.map((c) => (
            <tr key={c.id} data-credential={c.id}>
              <td>{c.member.fullName ?? ""} &lt;{c.member.email}&gt;</td>
              <td>{c.regSiteName ?? ""}</td>
              <td><code>{c.regIp ?? ""}</code></td>
              <td title={c.regUa ?? ""}><small>{c.aaguid ?? ""}</small></td>
              <td>{c.synced ? "yes (copies to the user's other devices)" : "no"}</td>
              <td>{new Date(c.createdAt).toISOString()}</td>
              <td>
                {c.member.id === meId ? (
                  <span className="muted">your own</span>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(c.id, "approve", String(new FormData(e.currentTarget).get("code") ?? ""));
                    }}
                  >
                    <input name="code" placeholder="code" aria-label={`code for ${c.member.email}`} size={7} />{" "}
                    <button type="submit">Approve</button>{" "}
                    <button type="button" onClick={() => act(c.id, "reject")}>Reject</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Approved</h2>
      <ul>
        {approved.map((c) => (
          <li key={c.id} data-approved={c.id}>
            {c.member.email} · {c.aaguid ?? ""}{" "}
            {c.member.id === meId ? null : <button type="button" onClick={() => act(c.id, "revoke")}>Revoke</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
