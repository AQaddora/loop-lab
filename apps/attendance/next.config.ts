import type { NextConfig } from "next";

// BASE_PATH comes from env: empty in dev (the registered Google redirect is
// http://localhost:3000/api/auth/callback/google), "/attendance" on staging.
const basePath = process.env.BASE_PATH ?? "";
if (basePath !== "" && !/^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(basePath)) {
  throw new Error(`BASE_PATH must be empty or like "/attendance", got "${basePath}"`);
}

const nextConfig: NextConfig = {
  basePath,
  // e2e dev server uses its own dir so it never fights a human's `next dev` lock
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
