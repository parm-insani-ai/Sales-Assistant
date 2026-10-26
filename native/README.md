# viniva as a phone app

The web app at the repo root is the product. This wraps it, unchanged, in a
native iPhone app (for TestFlight) and a native Android app (for the Play
Store's internal testing track) with [Capacitor](https://capacitorjs.com).
Two things the phone's browser does badly are done natively instead:

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
| `android/` | The Gradle project. Already has the microphone and notification permissions, release signing from the environment, a version from the build, and launcher icons |
| `js/native.js` | The bridge: native speech behind `window.SpeechRecognition`, push registration (Apple's token on iPhone, Google's on Android), notification taps |
| `.github/workflows/ios-testflight.yml` | Builds and uploads to TestFlight from GitHub, no Mac needed |
| `.github/workflows/android-play.yml` | Builds a signed bundle and uploads it to Play internal testing |
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

## Android: one-time setup

1. **A Play Console developer account** ($25 once) at play.google.com/console,
   again in the company's name.
2. **An upload key.** On any machine with Java:
   `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Keep the file and both passwords somewhere safe; losing them means a new
   app listing. GitHub secrets: `ANDROID_KEYSTORE_B64` (`base64 -i upload.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`),
   `ANDROID_KEY_PASSWORD`.
3. **Firebase, for notifications.** console.firebase.google.com → new
   project → add an Android app with package `ai.entoa.viniva` → download
   `google-services.json`. GitHub secret `GOOGLE_SERVICES_JSON` (base64 of
   the file). Then Project settings → Service accounts → Generate new private
   key, and give that JSON file, as is, to the function as the secret
   `FCM_SERVICE_ACCOUNT`. Without these the app still builds and runs; it
   just can't be notified.
4. **The app record.** Play Console → Create app, package `ai.entoa.viniva`.
   Play insists the first bundle be uploaded by hand: run the Android
   workflow once with "upload" off, download the `.aab` from the run's
   artifacts, and upload it under Testing → Internal testing. After that
   the workflow uploads.
5. **A service account for uploads** (optional). Google Cloud → the
   Firebase project → IAM → create a service account, make a JSON key, and
   in the Play Console under Users and permissions invite its email with
   release access to the app. GitHub secret `PLAY_SERVICE_ACCOUNT_JSON`
   (the JSON as is).

Then Actions → **Android · build and upload to Play internal testing** →
Run workflow. Testers are added under Internal testing by email and install
from the link Play gives you; no review, live in minutes.

## Things to know

- The app and the Safari copy of viniva have separate storage. Signing in
  to Cloud sync in the app brings the book across; it is not a second book.
- Speech goes through Apple's recognizer on the device or Apple's servers,
  per the phone's settings. The permission prompts use the two strings in
  `ios/App/App/Info.plist`.
- The function tries Apple's production gateway first and falls back to the
  sandbox when a token is rejected, so Xcode builds and TestFlight builds
  can be on the same account at once.
- Speech on Android goes through the phone's recognition service (Google's
  on most phones); the same bridge code drives it.
- Nothing in `ios/App/App/public/` or `android/app/src/main/assets/public/`
  is committed: it is the copy of the web app the build makes. The Firebase
  file and keystores are ignored too; they live in secrets.
