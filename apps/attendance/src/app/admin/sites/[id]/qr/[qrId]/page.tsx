import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { sites, staticQrCodes } from "@/db/schema";
import { currentMember } from "@/lib/session";
import { scanUrl, staticToken } from "@/lib/static-qr";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; qrId: string }> };

/** Printable static QR (spec §1.1.4). The token is re-minted from the row, so nothing secret is stored. */
export default async function PrintQr({ params }: Props) {
  const { id, qrId } = await params;
  const me = await currentMember();
  if (!me) redirect(`/signin?callbackUrl=/admin/sites/${encodeURIComponent(id)}/qr/${encodeURIComponent(qrId)}`);
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) return <main data-error="forbidden" />;
  const db = getDb();
  const site = db.select().from(sites).where(and(eq(sites.id, id), eq(sites.orgId, me.orgId))).get();
  const row = site ? db.select().from(staticQrCodes).where(and(eq(staticQrCodes.id, qrId), eq(staticQrCodes.siteId, site.id))).get() : undefined;
  if (!site || !row) return <main data-error="bad_request"><h1>QR not found</h1></main>;
  const url = scanUrl(site.id, staticToken(site, row));
  const svg = await QRCode.toString(url, { type: "svg", margin: 2, width: 320 });
  return (
    <main data-qr-status={row.status}>
      <h1>{site.name}: check in here</h1>
      <p>Join the office Wi-Fi, then scan with your phone camera.</p>
      <div style={{ width: 320, background: "#fff" }} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="muted">
        {row.label ? `${row.label} · ` : ""}valid until {new Date(row.expiresAt).toISOString()} · status {row.status}
      </p>
      <p className="muted" style={{ wordBreak: "break-all" }} data-url={url}>
        {url}
      </p>
    </main>
  );
}
