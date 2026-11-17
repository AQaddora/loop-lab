"use client";
import { useCallback, useEffect, useState } from "react";
import { apiSend } from "@/components/api-client";

type K = { id: string; name: string; siteId: string; status: string; lastSeenAt: number | null };

export default function KiosksClient({ base, sites }: { base: string; sites: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<K[]>([]);
  const [pair, setPair] = useState<{ code: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchRows = useCallback(async () => (await apiSend<{ kiosks: K[] }>(base, "GET", "/api/admin/kiosks")).body.kiosks ?? [], [base]);
  useEffect(() => {
    let alive = true;
    fetchRows().then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [fetchRows]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await apiSend<{ pairingCode: string; pairUrl: string }>(base, "POST", "/api/admin/kiosks", { siteId: String(f.get("siteId")), name: String(f.get("name")) });
    if (r.status === 201) {
      setPair({ code: r.body.pairingCode, url: r.body.pairUrl });
      setError(null);
    } else setError(r.body.error ?? "error");
    setRows(await fetchRows());
  }
  async function revoke(id: string) {
    const r = await apiSend(base, "POST", `/api/admin/kiosks/${id}/revoke`, {});
    setError(r.status === 200 ? null : (r.body.error ?? "error"));
    setRows(await fetchRows());
  }

  return (
    <div data-error={error ?? undefined}>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <form onSubmit={create}>
        <select name="siteId" aria-label="site">{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{" "}
        <input name="name" placeholder="Entrance TV" aria-label="kiosk name" required /> <button type="submit">Create kiosk</button>
      </form>
      {pair ? (
        <p data-pairing-code={pair.code}>
          Pairing code <code style={{ fontSize: "1.5rem" }}>{pair.code}</code> (10 min). On the display, open <code>{pair.url}</code> from the office network.
        </p>
      ) : null}
      <ul>
        {rows.map((k) => (
          <li key={k.id} data-kiosk={k.id}>
            {k.name} · {k.status}{k.lastSeenAt ? ` · seen ${new Date(k.lastSeenAt).toISOString()}` : ""}{" "}
            {k.status !== "REVOKED" ? <button type="button" onClick={() => revoke(k.id)}>Revoke</button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
