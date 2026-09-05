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

test("API policy blocks deprecation before client-retirement evidence exists", () => {
  const current = JSON.parse(registryText);
  current.current = "v2";
  current.versions.v1.status = "deprecated";
  current.versions.v2 = {
    status: "current",
    introducedInClient: "2.0.0",
    routes: ["GET /v2/sync"],
    deprecation: null,
    retirement: null
  };
  assert.throws(
    () => readRegistry(JSON.stringify(current), "candidate"),
    /needs deprecation evidence/
  );
});

test("API policy requires current, supported, deprecated, and retired transitions", () => {
  const base = readRegistry(registryText, "base");
  const current = structuredClone(base);
  current.versions.v1.status = "retired";
  assert.throws(
    () => compareWithBase(current, base, "protected main"),
    /cannot transition from current to retired/
  );
});
