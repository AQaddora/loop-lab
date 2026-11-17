/** Next.js basePath (spec decision: empty in dev, "/attendance" on staging). */
export function basePath(): string {
  return process.env.BASE_PATH ?? "";
}

/**
 * Prefix an app-relative path ("/signin") with the base path, for absolute URLs and plain <a>/fetch() paths
 * built by hand. Not for next/navigation redirect() or <Link>: Next adds the base path to those itself.
 */
export function withBase(path: string): string {
  return `${basePath()}${path}`;
}

/**
 * Next hands route handlers a URL without the base path, but Auth.js parses its action under its own basePath
 * ("/attendance/api/auth"). Put the base path back into `href` (no-op when it is empty or already there).
 */
export function restoreBasePath(href: string, base: string = basePath()): string {
  if (base === "") return href;
  const url = new URL(href);
  if (url.pathname === base || url.pathname.startsWith(`${base}/`)) return href;
  url.pathname = `${base}${url.pathname}`;
  return url.toString();
}
