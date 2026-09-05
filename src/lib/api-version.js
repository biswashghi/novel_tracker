export const API_VERSION_HEADER = "x-novel-tracker-api-version";
export const API_CLIENT_VERSION_HEADER = "x-novel-tracker-client-version";
export const API_CLIENT_PLATFORM_HEADER = "x-novel-tracker-client-platform";

export const API_CONTRACTS = Object.freeze({
  v1: Object.freeze({
    number: "1",
    endpoints: Object.freeze({
      pushMutations: Object.freeze({ method: "POST", path: "/v1/sync/mutations" }),
      pullSync: Object.freeze({ method: "GET", path: "/v1/sync" }),
      deleteSyncData: Object.freeze({ method: "DELETE", path: "/v1/account/data" }),
      deleteAccount: Object.freeze({ method: "DELETE", path: "/v1/account" })
    })
  })
});

export const API_VERSION = "v1";
export const API_VERSION_NUMBER = API_CONTRACTS[API_VERSION].number;
export const API_ROUTES = Object.freeze(Object.fromEntries(
  Object.entries(API_CONTRACTS[API_VERSION].endpoints).map(([name, endpoint]) => [name, endpoint.path])
));

export function apiClientHeaders({ version = "unknown", platform = "unknown" } = {}) {
  return {
    [API_VERSION_HEADER]: API_VERSION_NUMBER,
    [API_CLIENT_VERSION_HEADER]: String(version || "unknown"),
    [API_CLIENT_PLATFORM_HEADER]: String(platform || "unknown")
  };
}
