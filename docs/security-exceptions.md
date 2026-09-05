# Security exceptions

Exceptions are narrow, time-limited, and reviewed whenever Dependabot reports
a change. Production dependencies have no accepted high/critical exception.

## SEC-2026-09-01 — Firefox validator image parser

- **Status:** accepted for development/CI only
- **Expires:** 2026-10-04
- **Packages:** `web-ext@10.6.0` → `addons-linter` → `image-size@2.0.2`
- **Advisories:** GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq
- **Risk:** crafted ICNS/JXL/HEIF input can loop and deny service to the
  validator process.
- **Exposure:** `web-ext` is a development dependency and is absent from the
  production API image and every extension package. CI invokes it only on the
  repository-built Firefox directory, whose icons are repository-controlled
  PNG files. The plausible impact is a timed-out CI job, not application or
  user-data compromise.
- **Mitigation:** production audit remains a hard gate; the Firefox validation
  job has a timeout; package-content validation rejects unexpected development
  material; Dependabot checks weekly.
- **Exit:** update when Mozilla's current `web-ext`/`addons-linter` accepts a
  fixed `image-size`, or replace the validator. Do not apply npm's suggested
  downgrade to `web-ext@5.5.0`, which predates the current toolchain and does
  not represent a supported security upgrade.
