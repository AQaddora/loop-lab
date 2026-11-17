import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { credentials, members } from "@/db/schema";
import { freshDb } from "../helpers/db";
import { b64url, insertEvent, seedBasics } from "../helpers/fixtures";

let h: Handle;
beforeEach(() => {
  h = freshDb();
  seedBasics(h);
});

function addCred(id: string, status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED") {
  h.db
    .insert(credentials)
    .values({
      id,
      memberId: "m_emp1",
      credentialId: b64url(16),
      publicKey: b64url(64),
      backupEligible: false,
      backupState: false,
      status,
      createdAt: 1,
    })
    .run();
}

describe("schema invariants (spec §2.4, §4)", () => {
  it("allows at most one APPROVED credential per member", () => {
    addCred("c1", "APPROVED");
    expect(() => addCred("c2", "APPROVED")).toThrow(/UNIQUE/);
  });

  it("allows at most one PENDING credential per member, next to one APPROVED and any REVOKED/REJECTED", () => {
    addCred("c1", "APPROVED");
    addCred("c2", "PENDING");
    addCred("c3", "REVOKED");
    addCred("c4", "REVOKED");
    addCred("c5", "REJECTED");
    expect(() => addCred("c6", "PENDING")).toThrow(/UNIQUE/);
  });

  it("rejects unknown statuses and upper-case emails", () => {
    expect(() =>
      h.sqlite.prepare("INSERT INTO credentials (id, member_id, credential_id, public_key, backup_eligible, backup_state, status, created_at) VALUES ('x','m_emp1','cid','pk',0,0,'BOGUS',1)").run(),
    ).toThrow(/CHECK/);
    expect(() =>
      h.db
        .insert(members)
        .values({ id: "m2", orgId: "org_1", email: "Emp2@Acme.test", role: "employee", webauthnUserId: b64url(32), createdAt: 1 })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("keeps seq unique per org and VOID rows need corrects_seq", () => {
    insertEvent(h, 1);
    expect(() => insertEvent(h, 1)).toThrow(/UNIQUE/);
    expect(() =>
      h.sqlite
        .prepare("INSERT INTO attendance_events (id, org_id, seq, member_id, kind, source, effective_at, recorded_at, reason, actor_member_id, prev_hash, hash) VALUES ('v','org_1',2,'m_emp1','VOID','ADMIN',1,1,'r','m_emp1','p','h')")
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      h.sqlite
        .prepare("INSERT INTO attendance_events (id, org_id, seq, member_id, kind, source, effective_at, recorded_at, prev_hash, hash) VALUES ('a','org_1',2,'m_emp1','IN','ADMIN',1,1,'p','h')")
        .run(),
    ).toThrow(/CHECK/);
  });
});
