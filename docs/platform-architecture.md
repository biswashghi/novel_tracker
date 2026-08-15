# Platform architecture

Novel Tracker keeps reading behavior independent of the browser that hosts it.

## System map

```mermaid
flowchart TB
  subgraph Presentation["Outward-facing presentation layers"]
    Popup["Extension popup<br/>save and inspect progress"]
    Library["Library/options page<br/>manage, import, export, sync"]
    Content["Content scripts<br/>automatic chapter detection"]
    SafariApp["Safari containing app<br/>installation and permissions"]
  end

  subgraph Application["Application services and ports"]
    Background["Background message handlers"]
    SyncService["Sync service<br/>pull → push → confirm pull"]
    Auth["OAuth service<br/>PKCE, state, tokens, accounts"]
    SyncClient["Transport-neutral sync client"]
  end

  subgraph Domain["Shared business domain"]
    Novel["Novel state<br/>lifecycle, generation, LWW fields"]
    History["Chapter history<br/>append-only ChapterEvent set"]
    Mutation["Mutation log<br/>UUID idempotency"]
    Clock["Hybrid Logical Clock<br/>deterministic ordering"]
    Merge["Merge policy<br/>remove-wins + field LWW"]
    Identity["Novel identity matching<br/>canonical deduplication"]
  end

  subgraph Adapters["Platform and backend adapters"]
    ExtensionAPI["WebExtension adapter<br/>storage, tabs, scripting, alarms"]
    AuthPlatform["Interactive-auth adapter<br/>Chrome/Firefox identity or Safari native"]
    HTTPPlatform["HTTP transport adapter<br/>browser fetch or Safari native message"]
    Parsers["Site parser adapters<br/>Royal Road, Chikari, etc."]
    SafariNative["Safari native app extension<br/>ASWebAuthenticationSession + URLSession"]
    API["Novel Tracker API<br/>sync, account deletion"]
    Keycloak["Keycloak<br/>Google OIDC federation"]
    Postgres["PostgreSQL<br/>cloud state and mutation audit"]
  end

  Popup --> Background
  Library --> Background
  Content --> Parsers --> Background
  SafariApp -. hosts .-> SafariNative
  Background --> SyncService
  Background --> Auth
  SyncService --> SyncClient
  Background --> ExtensionAPI
  SyncService --> ExtensionAPI
  Auth --> ExtensionAPI
  Auth --> AuthPlatform
  Auth --> HTTPPlatform
  SyncClient --> HTTPPlatform
  AuthPlatform --> SafariNative
  HTTPPlatform --> SafariNative
  HTTPPlatform --> API
  HTTPPlatform --> Keycloak
  SafariNative --> API
  SafariNative --> Keycloak
  API --> Postgres
  API --> Keycloak
  SyncService --> Novel
  SyncClient --> Mutation
  Merge --> Novel
  Merge --> History
  Merge --> Mutation
  Merge --> Clock
  Merge --> Identity
```

Arrows crossing into the shared domain carry plain objects rather than browser
objects, HTTP responses, or native types. Platform adapters may change without
changing the merge rules or persisted domain model.

## Shared domain

`sync-core.js`, `sync-policy.js`, and the state transformations in
`sync-client.js` implement novel identity, mutations, Hybrid Logical Clocks,
deterministic merging, and history without Chrome, Firefox, or Safari API calls.
They operate on plain data and can be used unchanged by every client.

OAuth protocol behavior is also shared in `src/lib/auth.js`: PKCE generation,
state validation, token exchange, refresh, account switching, and persisted
session state do not depend on a particular browser.

## Platform boundary

`src/lib/extension-api.js` is the narrow WebExtension API compatibility layer.
`src/lib/auth-platform.js` selects one of two interactive authorization
adapters:

- Chrome and Firefox use the WebExtension `identity` API.
- Safari sends one native message to the generated Safari app extension.

`src/lib/platform-http.js` provides a separate outbound HTTP port. Chrome and
Firefox use `fetch`; Safari sends allowlisted HTTPS requests through its native
extension because Safari may reject extension-origin calls to authentication
and API hosts. Neither adapter can read or merge the library.

## Generated Safari application

Apple's converter generates the Xcode application and extension targets. The
generated Swift message handler is a placeholder, so the release script replaces
it with the maintained implementation in
`safari-native/SafariWebExtensionHandler.swift`.

`npm run package:safari` always converts into a temporary directory and emits a
versioned Xcode-project ZIP under `release/`. This prevents regeneration from
overwriting developer-team, signing, or other local settings in an existing
Xcode project.

The maintained Swift handler exposes two narrow platform capabilities: opening
`ASWebAuthenticationSession`, and performing HTTPS requests restricted to the
Novel Tracker Keycloak and API hosts. All authorization validation, sync
sequencing, conflict resolution, and application behavior remain in JavaScript.
