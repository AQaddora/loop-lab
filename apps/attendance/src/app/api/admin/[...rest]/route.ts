/**
 * Every /api/admin/* path without its own route: the admin check still runs first, so an employee gets
 * `forbidden` (and an anonymous caller `unauthenticated`) on every admin path; an admin gets 404.
 */
import { requireAdmin } from "@/lib/session";
import { errorJson, route } from "@/lib/http";

const handler = route(async () => {
  await requireAdmin();
  return errorJson("not_found");
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
