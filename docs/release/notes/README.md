# Release notes

One directory per version, added in the pull request that bumps
`package.json`'s version. The release workflow publishes them to each store;
see [../../release.md](../../release.md#cutting-a-release) for what each file
does and `scripts/release-plan.mjs` for the checks.

```text
docs/release/notes/1.2.0/
  app-store-ios.txt   What's New, iPhone and iPad   (required unless TestFlight only)
  app-store-mac.txt   What's New, Mac               (required unless TestFlight only)
  firefox.txt         Firefox Add-ons release notes (required)
  chrome.txt          Text to paste into the Chrome listing (optional)
  release.json        { "apple": "testflight" } and/or { "screenshots": true | false } (optional)
```

Write for readers, in plain text, under 4,000 characters per file. Say what
they can now do; leave out internal names, pull request numbers and code.
