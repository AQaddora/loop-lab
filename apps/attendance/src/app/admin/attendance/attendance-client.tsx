"use client";
import { useCallback, useEffect, useState } from "react";
import { apiSend } from "@/components/api-client";

type E = { seq: number; kind: string; source: string; memberId: string; memberEmail: string | null; memberName: string | null; siteName: string | null; effectiveAt: number; correctsSeq: number | null; reason: string | null; actorEmail: string | null; voided: boolean };

export default function AttendanceClient({ base }: { base: string }) {
  const [rows, setRows] = useState<E[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; firstBadSeq: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchRows = useCallback(async () => (await apiSend<{ events: E[] }>(base, "GET", "/api/admin/attendance")).body.events ?? [], [base]);
  useEffect(() => {
    let alive = true;
    fetchRows().then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [fetchRows]);

  async function check() {
    const r = await apiSend<{ ok: boolean; firstBadSeq: number | null }>(base, "GET", "/api/admin/attendance/verify");
    setVerify(r.body);
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kind = String(f.get("kind"));
    const body: Record<string, unknown> = { kind, reason: String(f.get("reason") ?? "") };
    if (kind === "VOID") body.correctsSeq = Number(f.get("seq"));
    else {
      body.memberId = String(f.get("memberId"));
      body.effectiveAt = Date.parse(String(f.get("when")));
    }
    const r = await apiSend(base, "POST", "/api/admin/attendance/corrections", body);
    setError(r.status === 201 ? null : (r.body.error ?? "error"));
    setRows(await fetchRows());
  }

  return (
    <div data-error={error ?? undefined}>
      <p>
        <a href={`${base}/api/admin/attendance/export.csv`}>Export CSV</a> ·{" "}
        <button type="button" onClick={check}>Verify chain</button>{" "}
        {verify ? <span data-verify={verify.ok ? "ok" : `bad:${verify.firstBadSeq}`}>{verify.ok ? "chain intact" : `chain broken at #${verify.firstBadSeq}`}</span> : null}
      </p>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <table>
        <thead><tr><th>#</th><th>Member</th><th>Kind</th><th>When (UTC)</th><th>Site</th><th>Source</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.seq} data-seq={e.seq} data-voided={e.voided ? "1" : undefined}>
              <td>{e.seq}</td>
              <td>{e.memberName ?? ""} {e.memberEmail}</td>
              <td>{e.kind}{e.voided ? " (voided)" : ""}</td>
              <td>{new Date(e.effectiveAt).toISOString()}</td>
              <td>{e.siteName ?? ""}</td>
              <td>{e.source === "ADMIN" ? `admin (${e.actorEmail ?? ""})` : "punch"}</td>
              <td>{e.kind === "VOID" ? `voids #${e.correctsSeq}. ` : ""}{e.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Add a correction</h2>
      <p className="muted">Corrections are new rows; the original never changes. A reason is required and the employee sees it.</p>
      <form onSubmit={submit}>
        <select name="kind" aria-label="kind" defaultValue="VOID">
          <option value="VOID">VOID a row</option>
          <option value="IN">manual IN</option>
          <option value="OUT">manual OUT</option>
        </select>{" "}
        <input name="seq" type="number" placeholder="row # to void" aria-label="seq" />{" "}
        <input name="memberId" placeholder="member id (IN/OUT)" aria-label="member id" />{" "}
        <input name="when" placeholder="2026-11-17T08:00:00Z" aria-label="when" />{" "}
        <input name="reason" placeholder="reason" aria-label="reason" required minLength={3} maxLength={500} />{" "}
        <button type="submit">Add correction</button>
      </form>
    </div>
  );
}
