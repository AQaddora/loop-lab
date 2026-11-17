import { basePath } from "@/lib/base-path";
import KioskClient from "./kiosk-client";

export const dynamic = "force-dynamic";

/** /kiosk (spec §1.2): the entrance display. It only shows server-minted tokens and hides them by server time. */
export default function KioskPage() {
  return (
    <main style={{ maxWidth: "48rem", textAlign: "center" }}>
      <KioskClient base={basePath()} />
    </main>
  );
}
