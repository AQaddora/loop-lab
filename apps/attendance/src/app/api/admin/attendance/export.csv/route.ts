/** GET /api/admin/attendance/export.csv — formula-escaped CSV of the whole log (spec §2.6). */
import { adminRead } from "@/lib/admin";
import { localTime, toCsv } from "@/lib/csv";
import { adminLog } from "@/lib/events";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  const log = adminLog(db, actor.orgId);
  const csv = toCsv(
    ["seq", "kind", "source", "member_email", "member_name", "employee_code", "site", "effective_at_utc", "effective_at_local", "recorded_at_utc", "corrects_seq", "reason", "actor_email", "voided"],
    log.map((e) => [
      e.seq, e.kind, e.source, e.memberEmail, e.memberName, e.employeeCode, e.siteName,
      new Date(e.effectiveAt).toISOString(), localTime(e.effectiveAt, e.siteTimezone), new Date(e.recordedAt).toISOString(),
      e.correctsSeq, e.reason, e.actorEmail, e.voided ? "yes" : "",
    ]),
  );
  return new Response(csv, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="attendance.csv"', "cache-control": "no-store" },
  });
});
