import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { API_CONTRACTS, API_VERSION } from "../src/lib/api-version.js";

const registryPath = "docs/api-versions.json";
const allowedStatuses = new Set(["current", "supported", "deprecated", "retired"]);
const requiredStores = new Set(["chrome", "firefox", "safari-macos", "safari-ios"]);
const allowedTransitions = {
  current: new Set(["current", "supported"]),
  supported: new Set(["supported", "deprecated"]),
  deprecated: new Set(["deprecated", "retired"]),
  retired: new Set(["retired"])
};

export function readRegistry(text, source) {
  let registry;
  try {
    registry = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }
  assert.equal(registry.schemaVersion, 1, `${source}: unsupported schemaVersion`);
  assert.equal(typeof registry.current, "string", `${source}: current must be a version id`);
  assert.ok(registry.versions && typeof registry.versions === "object", `${source}: versions are required`);
  assert.ok(registry.versions[registry.current], `${source}: current version is not registered`);
  assert.equal(registry.versions[registry.current].status, "current", `${source}: current version must have current status`);
  assert.equal(
    Object.values(registry.versions).filter((entry) => entry.status === "current").length,
    1,
    `${source}: exactly one API version must be current`
  );

  for (const [id, entry] of Object.entries(registry.versions)) {
    assert.match(id, /^v[1-9][0-9]*$/, `${source}: invalid API version id ${id}`);
    assert.ok(allowedStatuses.has(entry.status), `${source}: invalid status for ${id}`);
    assert.match(entry.introducedInClient, /^[0-9]+\.[0-9]+\.[0-9]+$/, `${source}: ${id} needs its first client version`);
    assert.ok(Array.isArray(entry.routes) && entry.routes.length, `${source}: ${id} must retain its route contract`);
    assert.equal(new Set(entry.routes).size, entry.routes.length, `${source}: ${id} has duplicate routes`);
    for (const route of entry.routes) {
      assert.match(route, /^(GET|POST|PUT|PATCH|DELETE) \/v[1-9][0-9]*(?:\/[^ ?]+)*$/, `${source}: invalid route ${route}`);
      assert.ok(route.includes(`/${id}/`) || route.endsWith(`/${id}`), `${source}: ${route} does not belong to ${id}`);
    }
    if (entry.status === "deprecated" || entry.status === "retired") validateDeprecation(id, entry.deprecation, source);
    if (entry.status === "retired") validateRetirement(id, entry.retirement, entry.deprecation, source);
  }
  return registry;
}

function validDate(value, label) {
  const timestamp = Date.parse(value);
  assert.ok(Number.isFinite(timestamp), `${label} must be an ISO date`);
  return timestamp;
}

function validateDeprecation(id, evidence, source) {
  assert.ok(evidence && typeof evidence === "object", `${source}: ${id} needs deprecation evidence`);
  assert.equal(evidence.allKnownClientsRetired, true, `${source}: ${id} cannot be deprecated while a known client uses it`);
  assert.ok(evidence.approvedBy, `${source}: ${id} deprecation needs explicit owner approval`);
  const approvedAt = validDate(evidence.approvedAt, `${source}: ${id} approvedAt`);
  const zeroTrafficSince = validDate(evidence.zeroTrafficSince, `${source}: ${id} zeroTrafficSince`);
  assert.ok(approvedAt - zeroTrafficSince >= 90 * 24 * 60 * 60 * 1000, `${source}: ${id} needs 90 days of zero observed traffic`);
  assert.match(evidence.evidenceDocument || "", /^docs\/api-retirements\/[a-zA-Z0-9._-]+\.md$/, `${source}: ${id} needs a retirement evidence document`);
  assert.ok(existsSync(evidence.evidenceDocument), `${source}: missing ${evidence.evidenceDocument}`);
  assert.ok(Array.isArray(evidence.storeChecks), `${source}: ${id} needs store rollout checks`);
  const stores = new Set();
  for (const check of evidence.storeChecks) {
    assert.ok(requiredStores.has(check.store), `${source}: ${id} has an unknown store check`);
    assert.equal(check.noKnownActiveClientUsesApi, true, `${source}: ${id} is still used in ${check.store}`);
    const checkedAt = validDate(check.checkedAt, `${source}: ${id} ${check.store} checkedAt`);
    assert.ok(checkedAt <= approvedAt && approvedAt - checkedAt <= 7 * 24 * 60 * 60 * 1000, `${source}: ${id} store checks must be within seven days before approval`);
    stores.add(check.store);
  }
  assert.deepEqual(stores, requiredStores, `${source}: ${id} must be checked in every store`);
}

function validateRetirement(id, evidence, deprecation, source) {
  assert.ok(evidence && typeof evidence === "object", `${source}: ${id} needs retirement evidence`);
  assert.ok(evidence.approvedBy, `${source}: ${id} retirement needs explicit owner approval`);
  const retiredAt = validDate(evidence.retiredAt, `${source}: ${id} retiredAt`);
  const deprecatedAt = validDate(deprecation.approvedAt, `${source}: ${id} deprecatedAt`);
  assert.ok(retiredAt - deprecatedAt >= 30 * 24 * 60 * 60 * 1000, `${source}: ${id} must remain deprecated for at least 30 days before retirement`);
  assert.equal(evidence.zeroTrafficContinued, true, `${source}: ${id} traffic must remain at zero through retirement`);
}

function expectedRoutes(contract) {
  return Object.values(contract.endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
}

export function compareWithBase(current, base, source) {
  for (const [id, previous] of Object.entries(base.versions)) {
    const next = current.versions[id];
    assert.ok(next, `${id} was deleted from the API registry; version records are permanent`);
    assert.ok(allowedTransitions[previous.status].has(next.status), `${id} cannot transition from ${previous.status} to ${next.status}`);
    if (previous.status !== "retired") {
      const nextRoutes = new Set(next.routes);
      for (const route of previous.routes) {
        assert.ok(nextRoutes.has(route), `${id} removed compatible route ${route}; add a new API major version instead`);
      }
    }
  }
  process.stdout.write(`API compatibility preserved against ${source}.\n`);
}

export function main() {
  const current = readRegistry(readFileSync(registryPath, "utf8"), registryPath);
  assert.equal(current.current, API_VERSION, "code API version and registry current version differ");
  const safariApp = readFileSync("safari-native/SafariAppViewController.swift", "utf8");
  assert.ok(safariApp.includes(`private let apiVersion = "${API_VERSION}"`), "native Safari app API version differs");
  for (const [id, contract] of Object.entries(API_CONTRACTS)) {
    assert.ok(current.versions[id], `code implements ${id}, but the API registry does not`);
    assert.equal(contract.number, id.slice(1), `${id} code contract has the wrong numeric header version`);
    assert.deepEqual(new Set(current.versions[id].routes), new Set(expectedRoutes(contract)), `${id} code routes and registry differ`);
  }
  for (const [id, entry] of Object.entries(current.versions)) {
    if (entry.status !== "retired") assert.ok(API_CONTRACTS[id], `${id} is ${entry.status} but has no code contract`);
  }

  const baseArg = process.argv.find((argument) => argument.startsWith("--base-ref="));
  if (baseArg) {
    const baseRef = baseArg.slice("--base-ref=".length);
    assert.match(baseRef, /^[a-zA-Z0-9._/-]+$/, "invalid base ref");
    const result = spawnSync("git", ["show", `${baseRef}:${registryPath}`], { encoding: "utf8" });
    if (result.status === 0) {
      compareWithBase(current, readRegistry(result.stdout, `${baseRef}:${registryPath}`), baseRef);
    } else if (!/does not exist|exists on disk, but not in/.test(result.stderr)) {
      throw new Error(`Could not read API registry from ${baseRef}: ${result.stderr.trim()}`);
    } else {
      process.stdout.write(`No API registry exists on ${baseRef}; validating bootstrap registry only.\n`);
    }
  }

  process.stdout.write(`API ${API_VERSION} contract and lifecycle policy are valid.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
