import Link from "next/link";
import { getDb } from "@/db";
import { memberHistory } from "@/lib/events";
import { employeePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

/** /me (spec §1.4.4): own history, including admin corrections and their reasons. */
export default async function MePage() {
  const g = await employeePage("/me");
  if ("blocked" in g) return <main data-error={g.blocked}><h1>Account suspended</h1></main>;
  const events = memberHistory(getDb(), g.member.id);
  return (
    <main>
      <h1>My attendance</h1>
      <table>
        <thead><tr><th>#</th><th>Kind</th><th>When (UTC)</th><th>Source</th><th>Note</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq} data-seq={e.seq} data-kind={e.kind} data-source={e.source} data-voided={e.voided ? "1" : undefined}>
              <td>{e.seq}</td>
              <td>{e.kind}{e.voided ? " (voided)" : ""}</td>
              <td>{new Date(e.effectiveAt).toISOString()}</td>
              <td>{e.source === "ADMIN" ? "admin correction" : "punch"}</td>
              <td>{e.kind === "VOID" ? `voids #${e.correctsSeq}. ` : ""}{e.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><Link href="/punch">Back</Link></p>
    </main>
  );
}
