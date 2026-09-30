import { getExtensionApi } from "./extension-api.js";

/**
 * Whether `url` is covered by one of the manifest's content-script match
 * patterns, i.e. whether the content script will follow the reader from
 * chapter to chapter there without the popup being opened again.
 *
 * Handles the pattern shapes the manifest uses: an exact scheme, a host that
 * is either exact or `*.` + domain (which also matches the bare domain, as
 * WebExtension match patterns do), and a path glob.
 */
export function matchesPattern(url, pattern) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const match = /^(https?|\*):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return false;
  const [, scheme, host, pathGlob] = match;

  const protocol = parsed.protocol.slice(0, -1);
  if (scheme === "*" ? !["http", "https"].includes(protocol) : protocol !== scheme) return false;

  const hostname = parsed.hostname.toLowerCase();
  if (host.startsWith("*.")) {
    const domain = host.slice(2).toLowerCase();
    if (hostname !== domain && !hostname.endsWith(`.${domain}`)) return false;
  } else if (host !== "*" && hostname !== host.toLowerCase()) {
    return false;
  }

  const pathPattern = new RegExp(`^${pathGlob.split("*").map(escapeRegExp).join(".*")}$`);
  return pathPattern.test(`${parsed.pathname}${parsed.search}`);
}

function escapeRegExp(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function autoTrackedPatterns(api = getExtensionApi()) {
  const scripts = api?.runtime?.getManifest?.()?.content_scripts || [];
  return scripts.flatMap((script) => script.matches || []);
}

/**
 * `true` / `false` when the manifest can be read, `null` when it cannot (a
 * mocked or unusual host), so callers can stay quiet instead of guessing.
 */
export function isAutoTrackedUrl(url, patterns = autoTrackedPatterns()) {
  if (!patterns.length) return null;
  return patterns.some((pattern) => matchesPattern(url, pattern));
}
