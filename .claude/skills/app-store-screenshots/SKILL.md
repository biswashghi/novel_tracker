---
name: app-store-screenshots
description: Capture App Store screenshots for iPhone (6.5"), iPad (13") and Mac into store-assets/app-store/{ios,ipad,macos}/. Use when asked to regrab, refresh, or recapture App Store / TestFlight / Safari screenshots after a design change.
---

# App Store screenshots

Output: `store-assets/app-store/{ios,ipad,macos}/NN-<shot>.jpg`, numbered in
upload order, 8 per platform, exact native sizes (no rescaling — App Store
Connect rejects anything else):

| Folder  | Slot in App Store Connect | Size      | Source                          |
| ------- | ------------------------- | --------- | ------------------------------- |
| `ios`   | iPhone 6.5" Display       | 1284×2778 | iPhone 14 Plus simulator        |
| `ipad`  | iPad 13" Display          | 2064×2752 | iPad Pro 13-inch (M5) simulator |
| `macos` | Mac                       | 2880×1800 | headless Chromium, 1440×900 @2x |

Everything is a real capture of the shipping UI (guideline 2.3.3 rejected the
old upscaled promo tiles). Demo content is invented — titles, covers, and
reading history come from `demoLibrary()` / `coverSvg()` in the script. Never
ship third-party cover art, site logos, or real novel pages (guideline 5.2.1).

## 1. Build

```bash
npm run build
npm run package:safari
xcodebuild -project "build/safari-xcode/Novel Tracker/Novel Tracker.xcodeproj" \
  -scheme "Novel Tracker (iOS)" -sdk iphonesimulator -configuration Debug \
  -derivedDataPath <scratch>/dd CODE_SIGNING_ALLOWED=NO build
```

The app build is only for the container-app shot (`08-app`); rebuild it when
`safari-native/` changes.

## 2. Scripted captures

```bash
export NOVEL_TRACKER_APP_PATH="<scratch>/dd/Build/Products/Debug-iphonesimulator/Novel Tracker.app"
node scripts/capture-appstore-screenshots.mjs --device=mac      # ~1 min
node scripts/capture-appstore-screenshots.mjs --device=iphone   # ~3 min
node scripts/capture-appstore-screenshots.mjs --device=ipad     # ~3 min
```

Run in the background; each device takes minutes. `--serve` serves the harness
pages at `http://localhost:8899/seed.html` for previewing in a browser.
`--keep-devices` leaves the simulator booted afterwards.

What the script handles (don't re-solve these):

- **Fresh simulators every run** (`NT-appstore-6.5in`, `NT-appstore-13in`):
  deleted and recreated, so leftover tabs, storage, or auth prompts never leak
  in. It will delete a simulator you configured by hand — capture manual shots
  first.
- **One Safari tab**: `openurl` opens a new tab per call, so it opens
  `seed.html` once and every page polls `/__shot` to follow the script.
- **Safari's first-run tip** is hidden with the global default
  `com.apple.TipKit.HideAllTips`.
- **Status bar** is pinned to 9:41, full signal, charged battery.
- **Safari is closed before the app shot** so no "◀ Safari" back link shows.
- Dark shots switch `simctl ui appearance dark` (Chromium `colorScheme` on Mac).

## 3. Manual shot: iPhone popup (`ios/02-popup.jpg`)

On iPhone, Safari shows the popup as a system sheet (its own "Novel Tracker"
title bar and blue ✓, covering Safari's toolbars). A page can't draw over
Safari's chrome and `simctl` can't tap, so the script skips this slot
(`manual: ["iphone"]`) and never overwrites the file. Capture it with the iOS
Simulator control tool (points for iPhone 14 Plus, 428×926):

1. Boot `NT-appstore-6.5in`, install the app, and pin the status bar:
   `xcrun simctl status_bar NT-appstore-6.5in override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100`
2. Enable the extension: `xcrun simctl openurl <dev> "App-prefs:SAFARI&path=WEB_EXTENSIONS"`,
   tap Extensions → Novel Tracker → Allow Extension. The simulator lags; wait
   2–4 s and screenshot before each tap.
3. Press HOME first, then `openurl` a supported chapter page. Opening from
   Settings leaves a "◀ Settings" back link in the status bar.
4. Tap the page-menu button at the left of the address pill (~113, 868), then
   "Novel Tracker" in the menu (its y shifts when Safari shows a tip; read it
   off a screenshot). Tap "Allow for One Day" if prompted.
5. Swipe the sheet up (214,470 → 214,80) to its full height. Half height cuts
   off at the Save bookmark button, and the page behind shows.
6. `xcrun simctl io NT-appstore-6.5in screenshot <scratch>/popup.png`, then
   convert it to `store-assets/app-store/ios/02-popup.jpg` (sharp, jpeg q92,
   4:4:4) and check it's 1284×2778.

The real sheet only shows the site's name, title, and URL as field text. The
"Already tracking…" state (the novel saved once before) is the strongest.

## 4. Verify

Build a contact sheet per folder with sharp and look at every image: no Safari
tips, no blank or loading pages, no back links in the status bar, no stale
library (initials instead of covers), correct dimensions.

## Open items

- The iPad popup (`ipad/02-popup`, `ipad/05-continue`) is still the scripted
  stand-in: a popover anchored top-right. It hasn't been checked against a
  real iPad popup the way the iPhone one was.
- `popup.css` fixes the popup at 390px, so wider phones show an empty strip on
  the right of the real sheet.
- `scripts/generate-appstore-screenshots.mjs` is the old rejected upscale path;
  don't use it.
