import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareWithBase, readRegistry } from "../scripts/check-api-compatibility.mjs";

const registryText = await readFile(new URL("../docs/api-versions.json", import.meta.url), "utf8");

test("API policy blocks removal of a route used by an installed client", () => {
  const base = readRegistry(registryText, "base");
  const current = structuredClone(base);
  current.versions.v1.routes.shift();
  assert.throws(
    () => compareWithBase(current, base, "protected main"),
    /removed compatible route/
  );
});

test("API policy blocks retirement before all clients have moved", () => {
  const current = JSON.parse(registryText);
  current.current = "v2";
  current.versions.v1.status = "retired";
  current.versions.v2 = {
    status: "current",
    introducedInClient: "2.0.0",
    routes: ["GET /v2/sync"],
    retirement: null
  };
  assert.throws(
    () => readRegistry(JSON.stringify(current), "candidate"),
    /needs retirement evidence/
  );
});

test("API policy has no deprecated holding state", () => {
  const current = JSON.parse(registryText);
  current.current = "v2";
  current.versions.v1.status = "deprecated";
  current.versions.v2 = {
    status: "current",
    introducedInClient: "2.0.0",
    routes: ["GET /v2/sync"],
    retirement: null
  };
  assert.throws(
    () => readRegistry(JSON.stringify(current), "candidate"),
    /invalid status for v1/
  );
});

test("API policy requires a supported phase before retirement", () => {
  const base = readRegistry(registryText, "base");
  const current = structuredClone(base);
  current.versions.v1.status = "retired";
  assert.throws(
    () => compareWithBase(current, base, "protected main"),
    /cannot transition from current to retired/
  );
});

test("API registry history remains immutable after retirement", () => {
  const base = readRegistry(registryText, "base");
  base.versions.v1.status = "retired";
  const current = structuredClone(base);
  current.versions.v1.routes.shift();
  assert.throws(
    () => compareWithBase(current, base, "protected main"),
    /removed compatible route/
  );
});
