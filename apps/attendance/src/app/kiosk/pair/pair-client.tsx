"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiSend } from "@/components/api-client";

export default function PairClient({ base, code }: { base: string; code: string }) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || code === "") return;
    sent.current = true;
    apiSend(base, "POST", "/api/kiosk/pair", { code }).then((r) => {
      if (r.status === 200) router.replace("/kiosk");
      else setError(r.body.error ?? "error");
    });
  }, [base, code, router]);

  if (code === "") return <p data-error="bad_request">Open the pairing link from the admin page.</p>;
  return error ? (
    <p className="error" data-error={error}>Pairing failed: <code>{error}</code></p>
  ) : (
    <p className="muted">Pairing…</p>
  );
}
