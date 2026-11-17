"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/components/api-client";

export default function SetupForm({ base }: { base: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cidr = String(f.get("cidr") ?? "").trim();
    const hd = String(f.get("hd") ?? "").trim();
    setBusy(true);
    const r = await apiSend(base, "POST", "/api/admin/setup", {
      org: { name: String(f.get("orgName")), allowedGoogleHd: hd === "" ? null : hd, allowSyncedPasskeys: f.get("synced") === "on" },
      site: {
        name: String(f.get("siteName")),
        timezone: String(f.get("timezone") || "UTC"),
        qrMode: String(f.get("qrMode")) as "rotating" | "static",
        networks: cidr === "" ? [] : [{ cidr }],
      },
    });
    setBusy(false);
    if (r.status === 201) router.push("/admin");
    else setError(r.body.error ?? "error");
  }

  return (
    <form onSubmit={submit} data-error={error ?? undefined}>
      <p><label>Organisation name <input name="orgName" required maxLength={100} /></label></p>
      <p><label>Google Workspace domain (optional) <input name="hd" placeholder="company.com" /></label></p>
      <p>
        <label><input name="synced" type="checkbox" defaultChecked /> Allow synced passkeys (iCloud / Google Password Manager)</label>
        <br />
        <small className="muted">Turning this off blocks almost every iPhone and Android phone.</small>
      </p>
      <p><label>First site name <input name="siteName" required maxLength={100} /></label></p>
      <p><label>Time zone <input name="timezone" defaultValue="UTC" /></label></p>
      <p>
        <label>QR mode{" "}
          <select name="qrMode" defaultValue="rotating">
            <option value="rotating">rotating (kiosk screen)</option>
            <option value="static">static (printed, weaker)</option>
          </select>
        </label>
      </p>
      <p><label>Office Wi-Fi egress CIDR <input name="cidr" placeholder="198.51.100.0/24" /></label></p>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <button type="submit" disabled={busy}>Create</button>
    </form>
  );
}
