import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { amoToken, createAmoClient } from "../scripts/amo-api.mjs";

test("the AMO token is an HS256 JWT signed with the secret and short-lived", () => {
  const token = amoToken("user:123", "shh", 1_000);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "HS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "user:123");
  assert.equal(claims.iat, 1_000);
  assert.ok(claims.exp - claims.iat <= 300, "AMO rejects tokens that live longer than five minutes");
  assert.ok(claims.jti);
  assert.equal(signature, createHmac("sha256", "shh").update(`${header}.${payload}`).digest("base64url"));
  assert.notEqual(amoToken("user:123", "shh", 1_000), token, "each token has its own jti");
});

function fakeAmo(previews) {
  const calls = [];
  const fetchImpl = async (url, { method, headers, body }) => {
    calls.push({ method, path: new URL(url).pathname, auth: headers.Authorization, body });
    if (method === "GET") return new Response(JSON.stringify({ default_locale: "en-US", previews }), { status: 200 });
    if (method === "POST") return new Response(JSON.stringify({ id: 99 }), { status: 201 });
    return new Response(null, { status: 204 });
  };
  return { calls, fetchImpl };
}

test("replacing screenshots uploads the new ones in order before removing the old", async () => {
  const { calls, fetchImpl } = fakeAmo([{ id: 1 }, { id: 2 }]);
  const amo = createAmoClient({ key: "k", secret: "s", addonId: "novel-tracker@bghimire.com", fetchImpl });

  const result = await amo.replacePreviews([
    { name: "01.jpg", data: Buffer.from("one") },
    { name: "02.jpg", data: Buffer.from("two") }
  ]);

  assert.deepEqual(result, { added: 2, removed: 2 });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    [
      "GET /api/v5/addons/addon/novel-tracker%40bghimire.com/",
      "POST /api/v5/addons/addon/novel-tracker%40bghimire.com/previews/",
      "POST /api/v5/addons/addon/novel-tracker%40bghimire.com/previews/",
      "DELETE /api/v5/addons/addon/novel-tracker%40bghimire.com/previews/1/",
      "DELETE /api/v5/addons/addon/novel-tracker%40bghimire.com/previews/2/"
    ]
  );
  assert.ok(calls.every((call) => call.auth.startsWith("JWT ")));
  assert.equal(calls[1].body.get("position"), "0");
  assert.equal(calls[2].body.get("position"), "1");
  assert.equal(calls[2].body.get("image").name, "02.jpg");
});

test("a failed upload leaves the existing screenshots in place", async () => {
  const calls = [];
  const fetchImpl = async (url, { method }) => {
    calls.push(method);
    if (method === "GET") return new Response(JSON.stringify({ previews: [{ id: 1 }] }), { status: 200 });
    return new Response("too large", { status: 400 });
  };
  const amo = createAmoClient({ key: "k", secret: "s", addonId: "x", fetchImpl });
  await assert.rejects(() => amo.replacePreviews([{ name: "a.jpg", data: Buffer.from("a") }]), /POST \/previews\/ failed \(400\): too large/);
  assert.equal(calls.includes("DELETE"), false);
});

test("a throttled request waits as long as AMO asks, then goes through", async () => {
  const waits = [];
  let posts = 0;
  const fetchImpl = async (url, { method }) => {
    if (method === "GET") return new Response(JSON.stringify({ previews: [] }), { status: 200 });
    posts += 1;
    if (posts === 1) {
      return new Response(JSON.stringify({ detail: "Request was throttled. Expected available in 58 seconds." }), { status: 429 });
    }
    if (posts === 2) return new Response("", { status: 429, headers: { "Retry-After": "7" } });
    return new Response(JSON.stringify({ id: 5 }), { status: 201 });
  };
  const amo = createAmoClient({ key: "k", secret: "s", addonId: "x", fetchImpl, wait: async (seconds) => waits.push(seconds) });

  assert.deepEqual(await amo.replacePreviews([{ name: "a.jpg", data: Buffer.from("a") }]), { added: 1, removed: 0 });
  assert.deepEqual(waits, [58, 7]);
});

test("throttling that never lets up still fails, after a bounded number of tries", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ detail: "Expected available in 999 seconds." }), { status: 429 });
  };
  const waits = [];
  const amo = createAmoClient({ key: "k", secret: "s", addonId: "x", fetchImpl, wait: async (seconds) => waits.push(seconds) });
  await assert.rejects(() => amo.getAddon(), /\(429\)/);
  assert.equal(attempts, 6);
  assert.ok(waits.every((seconds) => seconds === 120), "each wait is capped");
});

test("hasVersion tells an existing version from a missing one", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(url).pathname);
    return new Response(url.includes("v1.2.0") ? "{}" : "{\"detail\":\"Not found.\"}", { status: url.includes("v1.2.0") ? 200 : 404 });
  };
  const amo = createAmoClient({ key: "k", secret: "s", addonId: "novel-tracker@bghimire.com", fetchImpl });
  assert.equal(await amo.hasVersion("1.2.0"), true);
  assert.equal(await amo.hasVersion("9.9.9"), false);
  assert.equal(seen[0], "/api/v5/addons/addon/novel-tracker%40bghimire.com/versions/v1.2.0/");
});
