import type { Metadata } from "next";
import "./globals.css";

// every page renders per request, so each one carries the per-request CSP nonce (src/proxy.ts)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attendance",
  description: "On-site check-in with QR, office Wi-Fi and passkey",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
