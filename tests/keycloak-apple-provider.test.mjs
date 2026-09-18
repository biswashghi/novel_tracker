import assert from "node:assert/strict";
import { test } from "node:test";
import { appleProvider, upsertAppleProvider } from "../scripts/rotate-apple-secret.mjs";

const config = { teamId: "TEAM123456", servicesId: "app.noveltracker.signin", keyId: "KEY1234567" };
const admin = { baseUrl: "http://keycloak:8080", realm: "novel-tracker" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("Apple provisioning uses the POST-capable provider and keeps revocation settings", () => {
  const provider = appleProvider(config, "signed-jwt");

  assert.equal(provider.alias, "apple");
  assert.equal(provider.providerId, "apple");
  assert.equal(provider.enabled, true);
  assert.equal(provider.storeToken, true);
  assert.equal(provider.addReadTokenRoleOnCreate, true);
  assert.equal(provider.firstBrokerLoginFlowAlias, "first broker login");
  assert.equal(provider.config.teamId, "TEAM123456");
  assert.equal(provider.config.keyId, "KEY1234567");
  assert.equal(provider.config.clientId, "app.noveltracker.signin");
  assert.equal(provider.config.clientSecret, "signed-jwt");
  assert.equal(provider.config.defaultScope, "name email");
  assert.match(provider.config.authorizationUrl, /response_mode=form_post$/);
  assert.equal(provider.config.clientAuthMethod, "client_secret_post");
});

test("provisioning refuses to touch an existing alias when the JAR is absent", async () => {
  const calls = [];
  await assert.rejects(
    upsertAppleProvider(admin, config, "signed-jwt", "admin-token", async (url, options) => {
      calls.push([url, options.method || "GET"]);
      return json({ error: "not found" }, 400);
    }),
    /JAR is not loaded/
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /identity-provider\/providers\/apple$/);
});

test("a rerun creates and verifies Apple when the legacy alias is already gone", async () => {
  const calls = [];
  let created = false;
  const request = async (url, options) => {
    const method = options.method || "GET";
    calls.push(method);
    if (url.endsWith("/providers/apple")) return json({ id: "apple" });
    if (url.endsWith("/instances/apple")) return created ? json({ alias: "apple", providerId: "apple" }) : json(null, 404);
    if (url.endsWith("/instances") && method === "POST") {
      created = true;
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };
  assert.equal(await upsertAppleProvider(admin, config, "signed-jwt", "admin-token", request), "Created");
  assert.deepEqual(calls, ["GET", "GET", "POST", "GET"]);
});

test("migration fully replaces the generic OIDC alias with the Apple provider", async () => {
  const calls = [];
  let installed = false;
  const oldProvider = { alias: "apple", providerId: "oidc", internalId: "old-id", config: { customOption: "keep" } };
  const request = async (url, options) => {
    const method = options.method || "GET";
    calls.push([url, method, options.body && JSON.parse(options.body)]);
    if (url.endsWith("/providers/apple")) return json({ id: "apple" });
    if (url.endsWith("/instances/apple") && method === "GET") return json(installed ? { alias: "apple", providerId: "apple" } : oldProvider);
    if (url.endsWith("/instances/apple") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/instances") && method === "POST") {
      installed = true;
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };

  assert.equal(await upsertAppleProvider(admin, config, "signed-jwt", "admin-token", request), "Migrated");
  const removed = calls.findIndex(([, method]) => method === "DELETE");
  const createdIndex = calls.findIndex(([, method]) => method === "POST");
  assert.ok(removed < createdIndex);
  const created = calls[createdIndex][2];
  assert.equal(created.providerId, "apple");
  assert.equal(created.alias, "apple");
  assert.equal(created.config.customOption, undefined);
  assert.equal(created.internalId, undefined);
});

test("a failed Apple creation leaves no generic fallback and can be retried", async () => {
  const calls = [];
  let removed = false;
  const request = async (url, options) => {
    const method = options.method || "GET";
    calls.push(method);
    if (url.endsWith("/providers/apple")) return json({ id: "apple" });
    if (url.endsWith("/instances/apple") && method === "GET") return removed ? json(null, 404) : json({ alias: "apple", providerId: "oidc", config: {} });
    if (url.endsWith("/instances/apple") && method === "DELETE") {
      removed = true;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/instances") && method === "POST") return json({ error: "creation failed" }, 500);
    throw new Error(`Unexpected ${url}`);
  };
  await assert.rejects(upsertAppleProvider(admin, config, "signed-jwt", "admin-token", request), /Migrating.*failed \(500\)/);
  assert.deepEqual(calls, ["GET", "GET", "DELETE", "POST"]);
});
