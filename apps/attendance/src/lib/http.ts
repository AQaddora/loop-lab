import { AppError, ERROR_STATUS, isAppError, type ErrorCode } from "./errors";

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function errorJson(code: ErrorCode, extra: HeadersInit = {}): Response {
  return json({ error: code }, ERROR_STATUS[code], extra);
}

/** Wrap a route handler: AppError -> {"error": code} with its HTTP status; anything else -> 500. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (isAppError(e)) return errorJson(e.code);
      // Next.js control flow (redirect/notFound) must propagate
      if (e && typeof e === "object" && "digest" in e) throw e;
      console.error("route error", e);
      return json({ error: "internal" }, 500);
    }
  };
}

/** Parse a JSON body; non-JSON content type or bad JSON -> bad_request (spec §2.7: JSON content type). */
export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(ct)) throw new AppError("bad_request");
  try {
    return await req.json();
  } catch {
    throw new AppError("bad_request");
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Minimal HTML error page for route handlers (/s/…): tests assert <main data-error="code">. */
export function errorPage(code: ErrorCode, detail?: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance · ${esc(code)}</title></head><body><main data-error="${esc(code)}"><h1>Cannot continue</h1><p>Error: <code>${esc(code)}</code></p>${detail ? `<p>${esc(detail)}</p>` : ""}</main></body></html>`;
  return new Response(body, {
    status: ERROR_STATUS[code],
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
