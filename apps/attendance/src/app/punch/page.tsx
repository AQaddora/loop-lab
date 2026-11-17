import { headers } from "next/headers";
import Link from "next/link";
import { getDb } from "@/db";
import { basePath } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { meState } from "@/lib/me";
import { employeePage } from "@/lib/page-guard";
import { readTicketId } from "@/lib/tickets";
import PunchClient from "./punch-client";

export const dynamic = "force-dynamic";

/** /punch (spec §1.4): current state + the one valid action; a way out when the passkey is gone (§1.5). */
export default async function PunchPage() {
  const g = await employeePage("/punch");
  if ("blocked" in g) return <main data-error={g.blocked}><h1>Account suspended</h1></main>;
  const s = meState(getDb(), g.member, readTicketId((await headers()).get("cookie")), nowMs());
  return (
    <main data-state={s.punch.state} data-credential={s.credential.status}>
      <h1>{s.member.fullName ?? s.member.email}</h1>
      <p className="muted">You are currently <strong>{s.punch.state === "IN" ? "checked in" : "checked out"}</strong>.</p>
      {s.ticket ? (
        <>
          <p className="muted">Site: {s.ticket.site.name}</p>
          {s.credential.approved ? (
            <PunchClient base={basePath()} action={s.punch.nextAction} />
          ) : s.credential.pending ? (
            <p>
              Your passkey is waiting for admin approval. <Link href="/enroll">Show my code</Link>
            </p>
          ) : (
            <p>
              <Link href="/enroll">Register fingerprint / Face ID</Link>
            </p>
          )}
        </>
      ) : (
        <p className="error" data-error="ticket_missing">Scan the QR at the entrance first (on the office Wi-Fi).</p>
      )}
      <p style={{ marginTop: "2rem" }}>
        <Link href="/enroll" data-new-device>New phone / passkey deleted</Link> · <Link href="/me">My history</Link>
      </p>
    </main>
  );
}
