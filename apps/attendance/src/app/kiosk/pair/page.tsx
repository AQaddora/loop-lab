import { basePath } from "@/lib/base-path";
import PairClient from "./pair-client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ code?: string | string[] }> };

export default async function KioskPairPage({ searchParams }: Props) {
  const sp = await searchParams;
  const code = (Array.isArray(sp.code) ? sp.code[0] : sp.code) ?? "";
  return (
    <main>
      <h1>Pair this display</h1>
      <PairClient base={basePath()} code={code} />
    </main>
  );
}
