# App Store review response — submission 52860635

Rejection received 2026-09-04 against version 1.0.1 (49), reviewed on iPad Air
11-inch (M3). This is the record of what changed and the reply to send in App
Store Connect.

## Before resubmitting

1. **Apple Developer portal** — enable Sign in with Apple on App ID
   `app.noveltracker.extension`; create a Services ID (e.g.
   `app.noveltracker.signin`) with return URL
   `https://auth.novel.bghimire.com/realms/novel-tracker/broker/apple/endpoint`;
   create a Sign in with Apple key and keep the `.p8`.
2. **Production secrets** — add `APPLE_TEAM_ID`, `APPLE_SERVICES_ID`,
   `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `KEYCLOAK_ADMIN_CLIENT_ID`, and
   `KEYCLOAK_ADMIN_CLIENT_SECRET` to `/etc/novel-tracker/app.env`
   (see docs/operations.md).
3. **Keycloak** — deploy, then run `scripts/configure-keycloak.sh` and
   `npm run keycloak:apple`. Install `novel-tracker-apple-secret.timer`.
4. **Verify on staging** — sign in with Apple, confirm the `provider` claim
   arrives, then delete that account and confirm the Keycloak user is gone and
   Novel Tracker no longer appears under Settings → Sign in with Apple.
5. **App Store Connect** — change the Support URL to
   `https://github.com/biswashghi/novel_tracker/blob/main/docs/support.md`,
   upload the new screenshots from `store-assets/`, and attach a screen
   recording of account deletion **captured on a physical device** (Apple asks
   for a physical device; the simulator will not satisfy this).

## Reply to App Review

> Thank you for the detailed review. We have addressed all five items.
>
> **Guideline 4.8 — Login Services.** The app now offers Sign in with Apple as
> an equivalent login option alongside Google. It appears on the first screen of
> the Novel Tracker app, directly beneath Sign in with Google. Sign in with
> Apple limits collection to name and email, supports Apple's private email
> relay so the reader's address can stay hidden from us, and we do not collect
> interactions for advertising. Both options run the same authentication flow
> and receive the same data.
>
> **Guideline 5.1.1(v) — Account Deletion.** The app now offers account
> deletion. In the Novel Tracker app, sign in, then tap **Delete Account** at
> the bottom of the main screen and confirm. This permanently deletes the
> account and everything synced to it, not just a deactivation; for accounts
> created with Sign in with Apple we also revoke the Apple token, so Novel
> Tracker stops appearing under Settings → Sign in with Apple. The same option
> is available on the library page in any browser. A screen recording of the
> full flow is attached in App Review Information.
>
> **Guideline 2.3.3 — Screenshots.** We have replaced the 6.5-inch iPhone and
> 13-inch iPad screenshots. The new ones are captures of the app in use — the
> reading library with saved novels, reading statistics, and search and
> filtering — rather than promotional artwork.
>
> **Guideline 2.3 — Accurate Metadata.** All the described features are present.
> They live in the Safari extension rather than the container app, which we
> believe is why they were not found. To reach them:
>
> 1. Open **Settings → Apps → Safari → Extensions** and turn on Novel Tracker,
>    allowing it to access the reading sites you visit.
> 2. In Safari, open any chapter page on a supported site (for example
>    `royalroad.com`), tap the extensions button in the address bar, and choose
>    **Novel Tracker**.
> 3. In the popup, tap the **archive** button in the top-right corner. This opens
>    the library page, which contains browsing, search, sorting, editing,
>    deleting, and reopening of saved novels, plus **Export** and **Import** for
>    JSON backups in the top-right corner.
>
> The app's first screen now also lists these steps explicitly, including where
> to find the library, so the path is clear without leaving the app.
>
> **Guideline 1.5 — Safety.** The Support URL has been updated to a dedicated
> support page with contact details, setup help, and answers to common
> questions, replacing the link that pointed to the privacy policy.
>
> Demo account details are in App Review Information. Please let us know if
> anything else would help.

## What changed in the app

| Guideline | Change |
| --- | --- |
| 4.8 | Sign in with Apple added as a Keycloak-brokered identity provider. `AUTH_PROVIDERS` (`src/lib/config.js`) drives one button per provider in both the extension and the iOS/macOS app; only `kc_idp_hint` differs between them. Because it is brokered rather than native, Apple sign-in also works in Chrome and Firefox. |
| 5.1.1(v) | `DELETE /v1/account` now revokes the Apple token, erases synced data, and deletes the Keycloak user, in that order. Surfaced as **Delete Account** natively in the iOS app and on the library page. |
| 2.3 | The container app's setup guidance now names the library and everything in it. No feature was missing. |
| 2.3.3 | Screenshots are now real simulator captures at native size (2064×2752 and 1284×2778), produced by `npm run store:screenshots`. |
| 1.5 | Added `docs/support.md` and pointed the Support URL at it. |
