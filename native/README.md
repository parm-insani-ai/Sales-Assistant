# viniva as an iPhone app

The web app at the repo root is the product. This wraps it, unchanged, in a
native iPhone app with [Capacitor](https://capacitorjs.com), for TestFlight.
Two things the iPhone's browser does badly are done natively instead:

- **Listening.** `js/native.js` puts Apple's own speech recognizer behind
  the `SpeechRecognition` interface the app already uses. It hears a
  showroom, keeps listening until you stop talking, and works in the app
  regardless of iOS version.
- **Notifications.** The app registers with Apple's push service and saves
  the device token as its push record (`kind: "apns"`). The function sends
  through Apple for those devices and through web push for the rest. No
  "add to Home Screen first".

Everything else is the same files: `index.html`, `js/`, `css/`. In a browser
`native.js` does nothing.

## What's here

| Path | What |
|---|---|
| `package.json`, `capacitor.config.json` | The shell's dependencies and settings (`appId` is `ai.entoa.viniva`) |
| `native/build.mjs` | Copies the web app into `native/www`, the folder the shell bundles |
| `ios/` | The Xcode project. Already has the microphone and speech permission strings, the push entitlement, the push callbacks in `AppDelegate.swift`, and a 1024px icon |
| `js/native.js` | The bridge: native speech behind `window.SpeechRecognition`, push registration, notification taps |
| `.github/workflows/ios-testflight.yml` | Builds and uploads to TestFlight from GitHub, no Mac needed |
| `test/native.test.js` | The bridge, tested against a fake shell |

## One-time setup

1. **Apple Developer Program** ($99/yr) at developer.apple.com. Enrol as the
   company that will publish the app, not as yourself, if that company
   exists; the publisher name on the store is public and hard to change.
2. **Bundle id.** Certificates, Identifiers & Profiles → Identifiers → add an
   App ID `ai.entoa.viniva` with the **Push Notifications** capability. To
   use a different id, change `appId` in `capacitor.config.json` and
   `PRODUCT_BUNDLE_IDENTIFIER` in `ios/App/App.xcodeproj/project.pbxproj`,
   and set `APNS_BUNDLE_ID` on the function.
3. **The app record.** App Store Connect → Apps → New App, same bundle id.
4. **A push key.** Keys → add a key with Apple Push Notifications service
   (APNs) enabled. Download the `.p8` once (Apple won't show it again), note
   its Key ID. Your Team ID is under Membership. Give these to the function
   as secrets (Supabase → Edge Functions → Secrets):
   - `APNS_KEY_P8` — the whole text of the `.p8` file
   - `APNS_KEY_ID`, `APNS_TEAM_ID`
   - `APNS_BUNDLE_ID` only if it isn't `ai.entoa.viniva`
   - `APNS_SANDBOX=1` only while testing builds installed from Xcode
     (TestFlight builds use Apple's production gateway, the default)
5. **An App Store Connect API key** (Users and Access → Integrations → App
   Store Connect API → Team key, role App Manager). Download the `.p8`, note
   the Key ID and Issuer ID.
6. **A distribution certificate.** On any Mac: Xcode → Settings → Accounts →
   Manage Certificates → + → Apple Distribution. Then Keychain Access →
   export that certificate (with its private key) as a `.p12` with a
   password. If no Mac is handy, a one-off `openssl` request works too.
7. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64 of
   the file: `base64 -i AuthKey_XXXX.p8 | pbcopy`), `IOS_DIST_CERT_P12`
   (base64 of the .p12), `IOS_DIST_CERT_PASSWORD`.

## Shipping a build

Actions → **iOS · build and upload to TestFlight** → Run workflow. Leave
"live" off to bundle the current files into the app; turn it on to make the
shell load https://entoa.ai instead, so every web deploy reaches the phones
without another build. Live mode is the right setting for the pilot; bundled
is what a public App Store build should be.

The upload appears in App Store Connect → TestFlight after Apple processes
it, usually 10–30 minutes. Add testers under Internal Testing (your own
team, instant) or External Testing (anyone by email or public link, a short
beta review the first time). Testers install the TestFlight app from the
App Store and open your invitation. Builds expire after 90 days; run the
workflow again.

## On a Mac instead

```sh
npm install
npm run native:sync          # copies the web app and installs the pods
npm run native:open          # opens ios/App/App.xcworkspace in Xcode
```

Pick your team under Signing & Capabilities, plug in an iPhone, press Run.
Product → Archive → Distribute App → TestFlight does the upload by hand.

## Things to know

- The app and the Safari copy of viniva have separate storage. Signing in
  to Cloud sync in the app brings the book across; it is not a second book.
- Speech goes through Apple's recognizer on the device or Apple's servers,
  per the phone's settings. The permission prompts use the two strings in
  `ios/App/App/Info.plist`.
- The function tries Apple's production gateway first and falls back to the
  sandbox when a token is rejected, so Xcode builds and TestFlight builds
  can be on the same account at once.
- Android is a `npx cap add android` away; the bridge code is the same. The
  Play Store's internal testing track is the TestFlight equivalent. Push on
  Android needs Firebase set up, which is not done here.
- Nothing in `ios/App/App/public/` is committed: it is the copy of the web
  app the build makes.
