// TEST TOOLING ONLY, used by scripts/check-prod-no-test-mode.sh step 3 (AC-36, decision D-001 option A).
// Emulates "AUTH_TEST_MODE reaches a running production server": the flag is injected into
// process.env on the first HTTP request, i.e. after instrumentation register() (the boot guard) ran.
// The check then proves the test surfaces are dead code in the prod bundle anyway.
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
"use strict";
if (process.env.PRODCHECK_LATE_FLAG === "1") {
  const http = require("node:http");
  const emit = http.Server.prototype.emit;
  let done = false;
  http.Server.prototype.emit = function patchedEmit(event, ...args) {
    if (event === "request" && !done) {
      done = true;
      process.env.AUTH_TEST_MODE = "1";
      process.stderr.write("prodcheck: AUTH_TEST_MODE=1 injected into the running server\n");
    }
    return emit.call(this, event, ...args);
  };
}
