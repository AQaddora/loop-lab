import { redirect } from "next/navigation";
import { basePath } from "@/lib/base-path";
import { currentMember } from "@/lib/session";
import AttendanceClient from "./attendance-client";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const me = await currentMember();
  if (!me) redirect("/signin?callbackUrl=/admin/attendance");
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) return <main data-error="forbidden"><h1>Attendance</h1></main>;
  return (
    <main style={{ maxWidth: "64rem" }}>
      <h1>Attendance log</h1>
      <AttendanceClient base={basePath()} />
    </main>
  );
}
