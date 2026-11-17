"use client";
import { useState } from "react";
import { apiSend } from "@/components/api-client";

type M = { id: string; email: string; employeeCode: string | null; role: string; status: string; fullName: string | null };

/** "email,code,role" lines -> JSON array (the API takes one member or an array). */
function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.toLowerCase().startsWith("email"))
    .map((l) => {
      const [email, code, role] = l.split(",").map((c) => c.trim());
      return { email, ...(code ? { employeeCode: code } : {}), ...(role ? { role } : {}) };
    });
}

export default function MembersClient({ base, me, initial }: { base: string; me: { id: string; role: string }; initial: M[] }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const r = await apiSend<{ members: M[] }>(base, "GET", "/api/admin/members");
    if (r.status === 200) setRows(r.body.members);
  }
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const csv = String(f.get("csv") ?? "").trim();
    const body = csv
      ? parseCsv(csv)
      : { email: String(f.get("email")), employeeCode: String(f.get("code") || "") || null, role: String(f.get("role") || "employee") };
    const r = await apiSend(base, "POST", "/api/admin/members", body);
    setError(r.status === 201 ? null : (r.body.error ?? "error"));
    if (r.status === 201) form.reset();
    await reload();
  }
  async function setStatus(id: string, status: string) {
    const r = await apiSend(base, "PATCH", `/api/admin/members/${id}`, { status });
    setError(r.status === 200 ? null : (r.body.error ?? "error"));
    await reload();
  }

  return (
    <div data-error={error ?? undefined}>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <table>
        <thead><tr><th>Email</th><th>Code</th><th>Role</th><th>Status</th><th>Name</th><th /></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} data-member={m.email}>
              <td>{m.email}</td><td>{m.employeeCode ?? ""}</td><td>{m.role}</td><td>{m.status}</td><td>{m.fullName ?? ""}</td>
              <td>
                {m.id !== me.id && m.status === "ACTIVE" ? <button type="button" onClick={() => setStatus(m.id, "SUSPENDED")}>Suspend</button> : null}
                {m.id !== me.id && m.status === "SUSPENDED" ? <button type="button" onClick={() => setStatus(m.id, "ACTIVE")}>Reactivate</button> : null}
                {m.id !== me.id && m.status !== "REMOVED" ? <button type="button" onClick={() => setStatus(m.id, "REMOVED")}>Remove</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Add members</h2>
      <form onSubmit={add}>
        <p>
          <input name="email" type="email" placeholder="email" aria-label="email" />{" "}
          <input name="code" placeholder="employee code" aria-label="employee code" />{" "}
          <select name="role" defaultValue="employee" aria-label="role">
            <option value="employee">employee</option>
            {me.role === "owner" ? <option value="admin">admin</option> : null}
            {me.role === "owner" ? <option value="owner">owner</option> : null}
          </select>
        </p>
        <p><textarea name="csv" rows={4} cols={50} placeholder={"or paste CSV: email,code,role"} aria-label="csv" /></p>
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
