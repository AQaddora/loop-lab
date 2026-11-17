/**
 * Boot guard, second layer (spec §6.2, TH-14). `npm start` already refuses to boot with
 * AUTH_TEST_MODE set (scripts/assert-prod-env.mjs). This catches a production server started
 * some other way: it logs loudly and throws, so the server never serves a request.
 *
 * Then it opens the DB and applies the app's own migrations at boot (specs/prod-loop.md §4.2), so a
 * broken migration stops the server before /api/health can answer 200.
 */
export async function register() {
  if (process.env.NODE_ENV === "production" && (process.env.AUTH_TEST_MODE ?? "") !== "") {
    const msg = "FATAL: AUTH_TEST_MODE is set in a production server. Refusing to start (spec TH-14).";
    console.error(msg);
    throw new Error(msg);
  }
  // better-sqlite3 is a Node addon: load the DB only in the Node.js runtime, never in an edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getHandle } = await import("./db");
    try {
      getHandle();
    } catch (err) {
      console.error("FATAL: could not open or migrate the database. Refusing to start (specs/prod-loop.md §4.2).");
      throw err;
    }
  }
}
