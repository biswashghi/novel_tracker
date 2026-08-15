import test from "node:test";
import assert from "node:assert/strict";
import { createQueuedTask } from "../src/lib/sync-service.js";

test("a request arriving during an active sync schedules another pass", async () => {
  let calls = 0;
  let releaseFirst;
  const firstPass = new Promise((resolve) => { releaseFirst = resolve; });
  const run = createQueuedTask(async () => {
    calls += 1;
    if (calls === 1) await firstPass;
  });

  const active = run();
  const queued = run();
  assert.equal(active, queued);
  releaseFirst();
  await active;
  assert.equal(calls, 2);
});
