import type { Metadata } from "next";
import "./globals.css";

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
