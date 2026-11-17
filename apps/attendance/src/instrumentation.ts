/**
 * Boot guard, second layer (spec §6.2, TH-14). `npm start` already refuses to boot with
 * AUTH_TEST_MODE set (scripts/assert-prod-env.mjs). This catches a production server started
 * some other way: it logs loudly and throws, so the server never serves a request.
 */
export async function register() {
  if (process.env.NODE_ENV === "production" && (process.env.AUTH_TEST_MODE ?? "") !== "") {
    const msg = "FATAL: AUTH_TEST_MODE is set in a production server. Refusing to start (spec TH-14).";
    console.error(msg);
    throw new Error(msg);
  }
}
