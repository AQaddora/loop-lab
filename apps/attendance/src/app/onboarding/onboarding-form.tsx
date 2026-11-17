"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/components/api-client";

export default function OnboardingForm({ base, first, fullName, phone }: { base: string; first: boolean; fullName: string; phone: string }) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, string> = { fullName: String(f.get("fullName")), phone: String(f.get("phone")) };
    if (first) body.employeeCode = String(f.get("employeeCode"));
    const r = await apiSend(base, "POST", "/api/profile", body);
    if (r.status === 200) router.push("/enroll");
    else setError(r.body.error ?? "error");
  }
  return (
    <form onSubmit={submit} data-error={error ?? undefined}>
      <p><label>Full name <input name="fullName" required maxLength={100} defaultValue={fullName} /></label></p>
      {first ? <p><label>Employee code <input name="employeeCode" required maxLength={32} /></label></p> : null}
      <p><label>Phone <input name="phone" required inputMode="tel" defaultValue={phone} /></label></p>
      {error ? <p className="error" role="alert">Error: <code>{error}</code></p> : null}
      <button type="submit">{first ? "Continue" : "Save"}</button>
    </form>
  );
}
