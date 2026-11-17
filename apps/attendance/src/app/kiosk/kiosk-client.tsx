"use client";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

type Tok = { token: string; url: string; expiresAt: number; serverNow: number; rotationSeconds: number; site: { name: string } };

/**
 * Polls GET /api/kiosk/token every rotation_seconds/2. offset = serverNow - Date.now(); the QR is hidden
 * (element absent) once Date.now() + offset passes the last expiresAt without a fresh token, and at once on
 * any 401/403. It never shows a stale QR.
 */
export default function KioskClient({ base }: { base: string }) {
  const [tok, setTok] = useState<Tok | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const offset = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let next = 15_000;
      try {
        const r = await fetch(`${base}/api/kiosk/token`, { cache: "no-store", credentials: "same-origin" });
        const body = (await r.json()) as Tok & { error?: string };
        if (!alive) return;
        if (r.status === 200) {
          offset.current = body.serverNow - Date.now();
          setError(null);
          setTok(body);
          setImg(await QRCode.toDataURL(body.url, { margin: 1, width: 360 }));
          next = Math.max(1000, (body.rotationSeconds * 1000) / 2);
        } else {
          setError(body.error ?? `http_${r.status}`);
          if (r.status === 401 || r.status === 403) {
            setTok(null);
            setImg(null);
          }
        }
      } catch {
        if (alive) setError("offline");
      }
      if (alive) timer = setTimeout(poll, next);
    }
    poll();
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
    };
  }, [base]);

  const serverNow = now || (tok ? tok.serverNow : 0);
  const live = tok !== null && serverNow < tok.expiresAt;
  return (
    <section data-error={error ?? undefined}>
      <h1>{tok?.site.name ?? "Attendance"}</h1>
      {live && img ? (
        <div data-qr data-token={tok.token} data-url={tok.url}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL rendered client-side */}
          <img src={img} alt="Scan to check in" width={360} height={360} />
          <p>Scan with your phone camera, on the office Wi-Fi. Refreshes in {Math.max(0, Math.ceil((tok.expiresAt - serverNow) / 1000))} s.</p>
        </div>
      ) : (
        <p className="muted">{error === "kiosk_unauthorized" ? "This display is not paired." : "Waiting for a fresh code…"}</p>
      )}
      <p className="muted" data-server-now={serverNow || undefined}>{serverNow ? new Date(serverNow).toISOString().slice(11, 19) : ""} server time</p>
    </section>
  );
}
