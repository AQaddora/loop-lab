/**
 * Test-only surfaces (spec §7.2): POST /api/test/{reset,login,clock,qr,tamper}.
 * Every one returns 404 unless isTestMode(), which is dead code in a production build.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { signIn, TEST_LOGIN_ID } from "@/auth";
import { getDb, getHandle } from "@/db";
import { sites } from "@/db/schema";
import { nowMs, setTestClock } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { errorJson, json, readJson, route } from "@/lib/http";
import { mintRotating } from "@/lib/qr";
import { resetAndSeed, tamperEvent } from "@/lib/test-seed";
import { isTestMode } from "@/lib/test-mode";
import { withBase } from "@/lib/base-path";

type Ctx = { params: Promise<{ action: string }> };

const notFound = () => errorJson("not_found");

const ResetBody = z
  .object({
    fixture: z.enum(["default", "empty"]).optional(),
    org: z
      .object({ allowedGoogleHd: z.string().min(1).nullable().optional(), allowSyncedPasskeys: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
const LoginBody = z
  .object({ email: z.string().min(1).max(320), sub: z.string().min(1).max(255).optional(), emailVerified: z.boolean().optional() })
  .strict();
const ClockBody = z
  .object({ offsetMs: z.number().finite().optional(), fixedMs: z.number().finite().optional() })
  .strict()
  .refine((c) => c.offsetMs === undefined || c.fixedMs === undefined);
const QrBody = z.object({ siteId: z.string().min(1).max(64), atMs: z.number().finite().optional() }).strict();
const TamperBody = z
  .object({ seq: z.number().int().min(1), field: z.string().min(1), value: z.union([z.string(), z.number(), z.null()]) })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new AppError("bad_request");
  return r.data;
}

async function body(req: Request): Promise<unknown> {
  const text = await req.clone().text();
  return text.trim() === "" ? {} : readJson(req);
}

export const POST = route(async (req: Request, ctx: Ctx) => {
  if (!isTestMode()) return notFound();
  const { action } = await ctx.params;
  switch (action) {
    case "reset": {
      const b = parse(ResetBody, await body(req));
      if (b.fixture === "empty" && b.org) throw new AppError("bad_request");
      setTestClock({});
      resetAndSeed(getHandle(), nowMs(), b);
      return json({ ok: true });
    }
    case "login": {
      const b = parse(LoginBody, await body(req));
      const url = await signIn(TEST_LOGIN_ID, {
        email: b.email,
        ...(b.sub ? { sub: b.sub } : {}),
        emailVerified: String(b.emailVerified ?? true),
        redirect: false,
        redirectTo: withBase("/"),
      });
      const error = new URL(String(url), "http://x").searchParams.get("error");
      return error ? json({ ok: false, error, url }, 403) : json({ ok: true, url });
    }
    case "clock": {
      const b = parse(ClockBody, await body(req));
      setTestClock(b);
      return json({ ok: true, ...b, nowMs: nowMs() });
    }
    case "qr": {
      const b = parse(QrBody, await body(req));
      const site = getDb().select().from(sites).where(eq(sites.id, b.siteId)).get();
      if (!site) throw new AppError("bad_request");
      const minted = mintRotating(site, process.env.QR_SIGNING_SECRET ?? "", b.atMs ?? nowMs());
      return json({ ...minted, url: withBase(`/s/${site.id}?t=${encodeURIComponent(minted.token)}`) });
    }
    case "tamper": {
      const b = parse(TamperBody, await body(req));
      let changes: number;
      try {
        changes = tamperEvent(getHandle(), b.seq, b.field, b.value);
      } catch {
        throw new AppError("bad_request");
      }
      return json({ ok: true, changes });
    }
    default:
      return notFound();
  }
});

export async function GET() {
  return notFound();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
