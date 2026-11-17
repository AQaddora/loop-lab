"use client";
import { useEffect, useState } from "react";
import { apiSend } from "@/components/api-client";

type Net = { id: string; cidr: string; label: string | null };
type Site = {
  id: string; name: string; timezone: string; qrMode: string; rotationSeconds: number; graceWindows: number;
  maxShiftHours: number; qrKeyVersion: number; status: string; networks: Net[];
};

export default function SiteClient({ base, initial }: { base: string; initial: Site }) {
  const [site, setSite] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ id: string; url: string; expiresAt: number } | null>(null);

  useEffect(() => {
    apiSend<{ ip: string | null }>(base, "GET", "/api/client-ip").then((r) => setMyIp(r.body.ip ?? null));
  }, [base]);

  async function call(method: "PATCH" | "POST" | "DELETE", path: string, body?: unknown) {
    const r = await apiSend<{ site: Site }>(base, method, path, body ?? (method === "DELETE" ? undefined : {}));
    if (r.status >= 200 && r.status < 300) {
      setError(null);
      if (r.body.site) setSite(r.body.site);
    } else setError(r.body.error ?? "error");
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await call("PATCH", `/api/admin/sites/${site.id}`, {
      name: String(f.get("name")),
      timezone: String(f.get("timezone")),
      qrMode: String(f.get("qrMode")),
      rotationSeconds: Number(f.get("rotationSeconds")),
      graceWindows: Number(f.get("graceWindows")),
      maxShiftHours: Number(f.get("maxShiftHours")),
    });
  }
  async function addNet(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await call("POST", `/api/admin/sites/${site.id}/networks`, { cidr: String(f.get("cidr")), label: String(f.get("label") || "") || undefined });
    form.reset();
  }

  async function mint(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await apiSend<{ qr: { id: string; url: string; expiresAt: number } }>(base, "POST", `/api/admin/sites/${site.id}/static-qr`, {
      ttlSeconds: Math.round(Number(f.get("days")) * 86_400),
      label: String(f.get("qrLabel") || "") || undefined,
    });
    if (r.status === 201) {
      setError(null);
      setMinted(r.body.qr);
    } else setError(r.body.error ?? "error");
  }

  return (
    <div data-error={error ?? undefined}>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <p className="muted">Status {site.status} · key version {site.qrKeyVersion} · your current IP: <code data-my-ip>{myIp ?? "unknown"}</code></p>
      <form onSubmit={save}>
        <p><label>Name <input name="name" defaultValue={site.name} /></label></p>
        <p><label>Time zone <input name="timezone" defaultValue={site.timezone} /></label></p>
        <p>
          <label>QR mode{" "}
            <select name="qrMode" defaultValue={site.qrMode}>
              <option value="rotating">rotating</option>
              <option value="static">static (only the IP gate protects a forwarded photo)</option>
            </select>
          </label>
        </p>
        <p><label>Rotation seconds (10–120) <input name="rotationSeconds" type="number" defaultValue={site.rotationSeconds} /></label></p>
        <p><label>Grace windows (0–2) <input name="graceWindows" type="number" defaultValue={site.graceWindows} /></label></p>
        <p><label>Max shift hours <input name="maxShiftHours" type="number" defaultValue={site.maxShiftHours} /></label></p>
        <button type="submit">Save</button>{" "}
        <button type="button" onClick={() => call("PATCH", `/api/admin/sites/${site.id}`, { status: site.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>
          {site.status === "ACTIVE" ? "Disable site" : "Enable site"}
        </button>{" "}
        <button type="button" onClick={() => call("PATCH", `/api/admin/sites/${site.id}`, { bumpKeyVersion: true })}>Revoke all QR codes (bump key)</button>
      </form>
      <h2>Office networks</h2>
      <ul>
        {site.networks.map((n) => (
          <li key={n.id} data-cidr={n.cidr}>
            <code>{n.cidr}</code> {n.label ?? ""}{" "}
            <button type="button" onClick={() => call("DELETE", `/api/admin/sites/${site.id}/networks/${n.id}`)}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={addNet}>
        <input name="cidr" placeholder="198.51.100.0/24" aria-label="cidr" /> <input name="label" placeholder="label" aria-label="label" />{" "}
        <button type="submit">Add network</button>
      </form>
      <p className="muted">Add both the IPv4 egress and the IPv6 prefix (e.g. /48 or /64) if the Wi-Fi has IPv6.</p>
      {site.qrMode === "static" ? (
        <>
          <h2>Printed QR</h2>
          <p className="muted">Weaker than a kiosk: a forwarded photo works until it expires, so only the IP gate protects it.</p>
          <form onSubmit={mint}>
            <input name="days" type="number" min={1} max={30} defaultValue={7} aria-label="days" /> days{" "}
            <input name="qrLabel" placeholder="label" aria-label="qr label" /> <button type="submit">Mint QR</button>
          </form>
          {minted ? (
            <p data-minted={minted.id}>
              <a href={`${base}/admin/sites/${site.id}/qr/${minted.id}`}>Print QR</a> (valid until {new Date(minted.expiresAt).toISOString()})
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
