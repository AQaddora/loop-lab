import { deployedVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

/** GET /api/health: {"ok":true} (AC-01), plus "version" (sha12) in a production image (PR-04). */
export function GET() {
  const version = deployedVersion();
  return Response.json(version === null ? { ok: true } : { ok: true, version });
}
