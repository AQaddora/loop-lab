import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("sanity", () => {
  it("health handler returns 200 {ok:true}", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
