#!/usr/bin/env node
// Brings the standardized local Postgres + Keycloak + API stack
// up or down for e2e testing. See docs/testing-locally.md.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeArgs = [
  "compose",
  "-p", "novel-tracker-local",
  "-f", path.join(root, "compose.yml"),
  "-f", path.join(root, "compose.local.yml")
];

const composeEnvironment = {
  ...process.env,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "novel-tracker-e2e-password",
  KEYCLOAK_ADMIN: process.env.KEYCLOAK_ADMIN || "admin",
  KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD || "novel-tracker-e2e-admin-password",
  AUTH_URL: process.env.AUTH_URL || "http://localhost:8793",
  KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER || "http://localhost:8793/realms/novel-tracker",
  KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL || "http://keycloak:8080/realms/novel-tracker/protocol/openid-connect/certs",
  // DELETE /v1/account removes the Keycloak user, not just synced rows, and
  // refuses outright without these. Seeded by infra/keycloak-realm.e2e.json.
  KEYCLOAK_ADMIN_URL: process.env.KEYCLOAK_ADMIN_URL || "http://keycloak:8080",
  KEYCLOAK_ADMIN_CLIENT_ID: process.env.KEYCLOAK_ADMIN_CLIENT_ID || "novel-tracker-admin",
  KEYCLOAK_ADMIN_CLIENT_SECRET:
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || "novel-tracker-e2e-admin-client-secret"
};

const mode = process.argv[2];
if (!["up", "down"].includes(mode)) {
  console.error("Usage: node scripts/e2e-stack.mjs <up|down>");
  process.exit(1);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: composeEnvironment });
    child.on("exit", (code) => (code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`))));
    child.on("error", reject);
  });
}

async function waitForKeycloakRealm(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const url = "http://localhost:8793/realms/novel-tracker/.well-known/openid-configuration";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keycloak is still starting or still importing the realm; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for the novel-tracker realm at ${url}. Check: make local-up`);
}

if (mode === "up") {
  await run("docker", [...composeArgs, "up", "-d", "--wait"]);
  console.log("Waiting for the novel-tracker realm to finish importing...");
  await waitForKeycloakRealm();
  console.log("Local e2e stack is ready: API on http://localhost:8792, Keycloak on http://localhost:8793");
} else {
  await run("docker", [...composeArgs, "down", "-v"]);
  console.log("Local e2e stack stopped and volumes removed.");
}
