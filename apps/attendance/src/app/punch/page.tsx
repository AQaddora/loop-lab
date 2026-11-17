import { headers } from "next/headers";
import Link from "next/link";
import { getDb } from "@/db";
import { nowMs } from "@/lib/clock";
import { meState } from "@/lib/me";
import { employeePage } from "@/lib/page-guard";
import { readTicketId } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** /punch (spec §1.4): the one valid action. The check-in ceremony itself lands in T11. */
export default async function PunchPage() {
  const g = await employeePage("/punch");
  if ("blocked" in g) return <main data-error={g.blocked}><h1>Account suspended</h1></main>;
  const s = meState(getDb(), g.member, readTicketId((await headers()).get("cookie")), nowMs());
  return (
    <main data-state={s.punch.state} data-credential={s.credential.status}>
      <h1>{s.punch.nextAction === "IN" ? "Check in" : "Check out"}</h1>
      {s.ticket ? <p className="muted">Site: {s.ticket.site.name}</p> : <p className="error">Scan the QR at the entrance first.</p>}
      {s.credential.status === "NONE" ? <p><Link href="/enroll">Register fingerprint / Face ID</Link></p> : null}
      {s.credential.status === "PENDING" && !s.credential.approved ? <p>Waiting for admin approval.</p> : null}
    </main>
  );
}
