# Platform architecture

Novel Tracker keeps reading behavior independent of the browser that hosts it.

## Shared domain

The modules under `src/lib/` that implement novel identity, mutations, Hybrid
Logical Clocks, deterministic merging, history, and synchronization contain no
Chrome, Firefox, or Safari API calls. They operate on plain data and can be used
unchanged by every client.

OAuth protocol behavior is also shared in `src/lib/auth.js`: PKCE generation,
state validation, token exchange, refresh, account switching, and persisted
session state do not depend on a particular browser.

## Platform boundary

`src/lib/extension-api.js` is the narrow WebExtension API compatibility layer.
`src/lib/auth-platform.js` selects one of two interactive authorization
adapters:

- Chrome and Firefox use the WebExtension `identity` API.
- Safari sends one native message to the generated Safari app extension.

The Safari adapter returns only the OAuth callback URL. It cannot read or merge
the library and does not contain synchronization rules.

## Generated Safari application

Apple's converter generates the Xcode application and extension targets. The
generated Swift message handler is a placeholder, so the release script replaces
it with the maintained implementation in
`safari-native/SafariWebExtensionHandler.swift`.

`npm run package:safari` always converts into a temporary directory and emits a
versioned Xcode-project ZIP under `release/`. This prevents regeneration from
overwriting developer-team, signing, or other local settings in an existing
Xcode project.

The maintained Swift handler has one responsibility: open
`ASWebAuthenticationSession` and return its callback URL to the WebExtension.
All authorization validation and application behavior remain in JavaScript.
