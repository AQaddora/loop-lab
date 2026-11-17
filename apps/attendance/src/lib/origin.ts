/**
 * CSRF guard for every state-changing route except Auth.js's own and /api/test/* (spec §2.7, §2.5 step 1):
 * an `Origin` header equal to the AUTH_URL origin (missing = bad_origin: browsers always send it on POST),
 * then a JSON content type (bad_request).
 */
import { AppError } from "./errors";

export function expectedOrigin(authUrl: string | undefined = process.env.AUTH_URL): string {
  if (!authUrl) throw new Error("AUTH_URL must be set");
  return new URL(authUrl).origin;
}

export function assertOrigin(req: Request, authUrl?: string): void {
  const origin = req.headers.get("origin");
  if (origin === null || origin === "" || origin === "null" || origin !== expectedOrigin(authUrl)) {
    throw new AppError("bad_origin");
  }
}

export function assertJson(req: Request): void {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(ct)) throw new AppError("bad_request");
}

/** Step 1 of every state-changing request. */
export function assertWriteRequest(req: Request, authUrl?: string): void {
  assertOrigin(req, authUrl);
  assertJson(req);
}
