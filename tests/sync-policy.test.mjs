import test from "node:test";
import assert from "node:assert/strict";
import { clampMutationClock, MAX_FUTURE_CLOCK_MS } from "../src/lib/sync-policy.js";

test("server clock policy clamps future wall time and preserves a safe logical counter", () => {
  const now = 1_000;
  const mutation = clampMutationClock({
    deviceId: "device-a",
    clock: { wallMs: now + MAX_FUTURE_CLOCK_MS + 50_000, logical: 7.9, actorId: "spoofed" }
  }, now);
  assert.deepEqual(mutation.clock, {
    wallMs: now + MAX_FUTURE_CLOCK_MS,
    logical: 7,
    actorId: "device-a"
  });
});
