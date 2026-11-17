import { basePath } from "@/lib/base-path";
import { employeePage } from "@/lib/page-guard";
import OnboardingForm from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const g = await employeePage("/onboarding", { allowIncomplete: true });
  if ("blocked" in g) return <main data-error={g.blocked}><h1>Account suspended</h1></main>;
  const m = g.member;
  return (
    <main>
      <h1>{m.profileCompletedAt ? "Your profile" : "Welcome"}</h1>
      <p className="muted">{m.email}</p>
      <OnboardingForm base={basePath()} first={m.profileCompletedAt === null} fullName={m.fullName ?? ""} phone={m.phone ?? ""} />
    </main>
  );
}
