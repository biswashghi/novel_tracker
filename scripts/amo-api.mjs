// The parts of the addons.mozilla.org API the release uses beyond what
// `web-ext sign` covers: the listing's default locale and its screenshots
// ("previews"). https://mozilla.github.io/addons-server/topics/api/
import { createHmac, randomUUID } from "node:crypto";

export const AMO_API = "https://addons.mozilla.org/api/v5";

const base64Url = (value) => Buffer.from(value).toString("base64url");

/** A short-lived JWT for the AMO API, signed with the API secret (HS256). */
export function amoToken(key, secret, now = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  // AMO rejects tokens that live longer than five minutes.
  const payload = base64Url(JSON.stringify({ iss: key, jti: randomUUID(), iat: now, exp: now + 60 }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function createAmoClient({ key, secret, addonId, fetchImpl = fetch }) {
  async function request(method, path, body) {
    const response = await fetchImpl(`${AMO_API}/addons/addon/${encodeURIComponent(addonId)}${path}`, {
      method,
      headers: { Authorization: `JWT ${amoToken(key, secret)}` },
      body
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AMO ${method} ${path || "/"} failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    getAddon: () => request("GET", "/"),

    /**
     * Makes the listing's screenshots exactly `images` ({ name, data }), in
     * order. The new ones go up before any old one is removed, so a failure
     * part way leaves the listing with screenshots rather than without.
     */
    async replacePreviews(images) {
      const existing = (await request("GET", "/")).previews || [];
      for (const [position, image] of images.entries()) {
        const form = new FormData();
        form.append("image", new Blob([image.data], { type: "image/jpeg" }), image.name);
        form.append("position", String(position));
        await request("POST", "/previews/", form);
      }
      for (const preview of existing) await request("DELETE", `/previews/${preview.id}/`);
      return { added: images.length, removed: existing.length };
    }
  };
}
