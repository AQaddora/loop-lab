import { headers } from "next/headers";
import { getDb } from "@/db";
import { basePath } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { meState } from "@/lib/me";
import { employeePage } from "@/lib/page-guard";
import { readTicketId } from "@/lib/tickets";
import EnrollClient from "./enroll-client";

export const dynamic = "force-dynamic";

export default async function EnrollPage() {
  const g = await employeePage("/enroll");
  if ("blocked" in g) return <main data-error={g.blocked}><h1>Account suspended</h1></main>;
  const state = meState(getDb(), g.member, readTicketId((await headers()).get("cookie")), nowMs());
  return (
    <main>
      <h1>Register this phone</h1>
      <EnrollClient base={basePath()} initialPendingCode={state.credential.pending?.confirmCode ?? null} hasTicket={state.ticket !== null} siteName={state.ticket?.site.name ?? null} />
    </main>
  );
}
