import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/check-ac-coverage.sh");

// Marker strings are assembled at runtime so this file never contains them literally
// (the guard scans tests/ too, and would otherwise flag its own test).
const dot = ".";
const M = {
  skip: `test${dot}skip(`,
  only: `test${dot}only(`,
  fixme: `test${dot}fixme(`,
  todo: `test${dot}todo("AC-02 later")`,
  xit: `${"x"}it(`,
  xdescribe: `${"x"}describe(`,
  fail: `test${dot}fail(`,
  pwnt: `pass${"WithNoTests"}: true`,
};

const SPEC_MD = `# Spec

## 8. Acceptance criteria

| AC | Criterion | Test (file › title prefix) |
|---|---|---|
| AC-01 | health | \`e2e/smoke.spec.ts\` › AC-01 health |
| AC-02 | ip | \`tests/unit/ip.test.ts\` › AC-02 client ip |
| AC-03 | prod guard | \`scripts/check-prod.sh\` |
| AC-39 | staging | \`scripts/smoke-remote.sh <url>\` |
| AC-10 | ten | \`e2e/x.spec.ts\` › AC-10 ten |

## 9. Open decisions

| AC-77 | not in §8, must be ignored | x |
`;

let root: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function run(args: string[] = []) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SPEC: path.join(root, "spec.md"),
      TEST_DIRS: `${path.join(root, "tests")} ${path.join(root, "e2e")}`,
      TEST_CONFIGS: `${path.join(root, "vitest.config.ts")} ${path.join(root, "playwright.config.ts")}`,
      APP_DIR: root,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function fullyCovered() {
  write("spec.md", SPEC_MD);
  write("e2e/smoke.spec.ts", `import { test } from "@playwright/test";\ntest("AC-01 health", async () => {});\n`);
  write("tests/unit/ip.test.ts", `describe("AC-02 client ip extraction", () => {\n  it("works", () => {});\n});\n`);
  write("e2e/x.spec.ts", `test(\n  "AC-10 ten: title on its own line",\n  async () => {},\n);\n`);
  write("scripts/check-prod.sh", "#!/bin/sh\n# AC-03 prod guard\n");
  write("vitest.config.ts", "export default {};\n");
  write("playwright.config.ts", "export default { forbidOnly: true };\n");
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ac-coverage-"));
  fullyCovered();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-40 coverage guard", () => {
  it("AC-40 coverage guard: exits 0 when every AC (no args = all but AC-39) has a titled test", () => {
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("ok     AC-03 (scripts/check-prod.sh)");
    expect(r.out).not.toContain("AC-39");
    expect(r.out).not.toContain("AC-77");
    expect(run(["AC-01", "AC-10"]).code).toBe(0);
  });

  it("AC-40 coverage guard: a missing id fails, and mentions outside a title do not count", () => {
    write("e2e/smoke.spec.ts", `// AC-01 health is covered somewhere\nconst s = "AC-01 health";\ntest("health AC-01", () => {});\n`);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/MISSING AC-01/);
    expect(run(["AC-02"]).code).toBe(0);
    expect(run(["AC-01"]).code).not.toBe(0);
  });

  it("AC-40 coverage guard: an id prefix is not coverage (AC-1 vs AC-10), unknown ids fail", () => {
    write("e2e/x.spec.ts", `test("AC-100 other", () => {});\n`);
    expect(run(["AC-10"]).code).not.toBe(0);
    expect(run(["AC-55"]).code).not.toBe(0);
    expect(run(["bogus"]).code).not.toBe(0);
  });

  it("AC-40 coverage guard: a script AC needs its script to exist and contain the id", () => {
    write("scripts/check-prod.sh", "#!/bin/sh\necho no id here\n");
    expect(run(["AC-03"]).code).not.toBe(0);
    rmSync(path.join(root, "scripts/check-prod.sh"));
    expect(run(["AC-03"]).code).not.toBe(0);
    // AC-39 is checked only when asked for
    expect(run(["AC-39"]).code).not.toBe(0);
    write("scripts/smoke-remote.sh", "#!/bin/sh\n# AC-39 staging smoke\n");
    write("scripts/check-prod.sh", "#!/bin/sh\n# AC-03\n");
    expect(run(["AC-39"]).code).toBe(0);
  });

  it("AC-40 coverage guard: any skip/only/fixme/todo/xit/xdescribe/fail marker fails, even with full coverage", () => {
    for (const [name, marker] of Object.entries(M)) {
      if (name === "pwnt") continue;
      fullyCovered();
      write("e2e/extra.spec.ts", `${marker}"AC-01 extra", () => {});\n`);
      const r = run(["AC-01"]);
      expect(r.code, `${name}: ${r.out}`).not.toBe(0);
      expect(r.out).toMatch(/FORBIDDEN/);
      rmSync(path.join(root, "e2e/extra.spec.ts"));
    }
    // describe-level and unit-test variants too
    write("tests/unit/more.test.ts", `describe${dot}skip("AC-02 x", () => {});\n`);
    expect(run(["AC-02"]).code).not.toBe(0);
  });

  it("AC-40 coverage guard: pass-with-no-tests in a test config fails", () => {
    write("vitest.config.ts", `export default { test: { ${M.pwnt} } };\n`);
    expect(run().code).not.toBe(0);
    fullyCovered();
    write("playwright.config.ts", `export default { ${M.pwnt} };\n`);
    expect(run().code).not.toBe(0);
    fullyCovered();
    expect(run().code).toBe(0);
  });

  it("AC-40 coverage guard: ordinary words are not markers (exit(), forbidOnly, a skipped variable)", () => {
    write("tests/unit/ok.test.ts", `const skipped = 1; if (skipped < 0) process.exit(1); const only = [1].length; it("AC-02 fine", () => {});\n`);
    expect(run(["AC-02"]).code).toBe(0);
  });
});
