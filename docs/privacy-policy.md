# Novel Tracker privacy policy

Novel Tracker works without an account. When used locally, reading data remains
in the browser's extension storage and is not sent to Novel Tracker servers.

If a reader chooses **Sign in with Google** or **Sign in with Apple**, Novel
Tracker receives the account identifier, name, and email supplied through
Keycloak. Readers who use Sign in with Apple may choose Apple's private email
relay, in which case Novel Tracker only ever sees the relay address. Novel
Tracker also stores the reader's saved novel titles, source sites, chapter URLs,
chapter labels, cover URLs, reading status, chapter history, and synchronization
timestamps. This information is used only to synchronize the reader's library
across their devices. Novel Tracker does not sell the information, use it for
advertising, or run behavioral analytics.

Signing in with Google and signing in with Apple create two separate Novel
Tracker accounts, even when both use the same email address, and each keeps its
own synced library.

Readers may sign out at any time without deleting the library stored on that
device. **Delete Account** — available in the Novel Tracker app on iPhone and
iPad, and on the library page in any browser — permanently deletes the Novel
Tracker account together with everything synchronized to it, and removes the
account from the identity provider. For accounts created with Sign in with
Apple, Novel Tracker also revokes its Apple token, so the app stops appearing
under Sign in with Apple in iOS Settings. The library stored on the device is
retained and can be exported beforehand. Deleted-novel tombstones are retained
for up to 30 days to prevent offline devices from restoring stale records.

JSON export and import occur only when explicitly initiated by the reader.

On Firefox, local-only use declares no required off-device data collection. If
a reader chooses sign-in, Firefox requests its built-in optional permissions for
authentication information, identifying information, browsing activity,
website activity, and website content before Novel Tracker starts the OAuth and
synchronization flow. Denying that request leaves the reader signed out and the
library local.
