#!/usr/bin/env node
// Brings the local Postgres + Keycloak + API stack (infra/docker-compose.yml)
// up or down for e2e testing. See docs/testing-locally.md.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const infraDir = path.join(root, "infra");
const composeArgs = [
  "compose",
  "-f", path.join(infraDir, "docker-compose.yml"),
  "-f", path.join(infraDir, "docker-compose.e2e.yml"),
  "--env-file", path.join(infraDir, ".env.e2e")
];

const mode = process.argv[2];
if (!["up", "down"].includes(mode)) {
  console.error("Usage: node scripts/e2e-stack.mjs <up|down>");
  process.exit(1);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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
  throw new Error(`Timed out waiting for the novel-tracker realm at ${url}. Check: docker compose -f infra/docker-compose.yml -f infra/docker-compose.e2e.yml logs keycloak`);
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
