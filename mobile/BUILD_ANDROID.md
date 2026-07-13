# FUTUREHAT Android — build & distribution

Production-quality Expo + React Native app that reuses the monorepo `shared/`
API and the **same Supabase backend as the deployed web app**.

## Prerequisites (already set up on the build machine)

- **JDK 17** — `brew install openjdk@17`
  → `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`
- **Android SDK** at `~/Library/Android/sdk` with:
  - `platforms;android-34`, `build-tools;34.0.0`, `platform-tools`, `cmdline-tools/latest`
- Node deps installed with a clean cache: `npm install --cache /tmp/fh-npm-cache`
  (the default `~/.npm` cache has permission issues on this machine).

## Environment for any Gradle command

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
```

## Build a signed release APK

```sh
cd mobile
node scripts/generate-assets.mjs          # (re)generate icon/splash if needed
npx expo prebuild -p android --no-install  # regenerate android/ from app.json
cd android
./gradlew assembleRelease --no-daemon
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

The release build is **minified + resource-shrunk** (R8) and **signed** with the
FUTUREHAT release key. Signing config lives in `android/app/build.gradle`
(`signingConfigs.release`) and reads credentials from `android/gradle.properties`
(`FUTUREHAT_UPLOAD_*`).

## 🔑 Keystore — BACK THIS UP

- File: `mobile/futurehat-release.keystore` (alias `futurehat`)
- Passwords: store & key = `futurehat2026` *(change before public release)*

**This keystore is git-ignored on purpose.** Copy it somewhere safe (password
manager / cloud). If you lose it you can never ship an update to the same app
listing on Google Play. Same applies to the passwords.

## Install on a device

- **Sideload:** transfer the APK to the phone and open it (enable
  "Install unknown apps" for the file manager / browser). Share it with friends
  the same way — no Play Store needed.
- **Over USB:** `adb install -r app-release.apk`

## Configuration

`mobile/.env` (git-ignored) holds the backend config; copy from `.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Later: Google Play

- Build an **AAB** instead: `./gradlew bundleRelease`
  → `app/build/outputs/bundle/release/app-release.aab`
- Enroll in Play App Signing and upload the AAB.
- Wire **Google Play Billing** for FUTUREHAT+ (currently activation is recorded
  via the shared API for testing; see `src/screens/PremiumScreen.tsx`).

## Media picker (0030) — native rebuild required

The production media picker adds **`expo-media-library`** (album enumeration + the
full-screen gallery). This is a native module, so a plain JS/OTA update is NOT enough
— you must regenerate the native project and rebuild:

```bash
cd mobile
npm install --legacy-peer-deps          # picks up expo-media-library
npx expo prebuild --clean               # regenerates android/ with the new module + permissions
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./android/gradlew -p android :app:assembleRelease
```

The Android manifest gains `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` (Android 13+) via
the `expo-media-library` config plugin in `app.json` (already wired). On first launch
the app requests photo/video access; the picker shows a permission-denied state if the
user declines.

> Phase B/C (crop/draw/text via `@shopify/react-native-skia`, video trim via
> `ffmpeg-kit-react-native`) add further native modules and will each require another
> `expo prebuild --clean` + rebuild when those phases land.

## Media editor Phase B/C (0030) — additional native modules

The image editor (crop/draw/text/stickers) and video editor add native modules:

- **`expo-image-manipulator`** — crop / rotate / flip / resize export (CropTool).
- **`@shopify/react-native-skia`** — drawing brushes + text/sticker flattening
  (DrawTool, mediaFlatten). Large native lib.
- **`expo-video-thumbnails`** — video filmstrip + cover-thumbnail selection.

Rebuild after installing (same as the picker):

```bash
cd mobile
npm install --legacy-peer-deps
npx expo prebuild --clean
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./android/gradlew -p android :app:assembleRelease
```

### Video transcode — NOT YET WIRED (intentional)
Trimming and muting are **recorded as intent** (`media_meta.trimStartMs / trimEndMs /
muted`) and previewed in the VideoEditor, but the actual cut/re-encode needs a native
transcoder that is **not installed**:

- Add `ffmpeg-kit-react-native` (note its LGPL/GPL licensing) **or**
  `react-native-video-trim`, then implement the transcode step in
  `src/media/tools/VideoEditor.tsx` (`onDone`) / the send path in
  `MediaPreviewScreen.tsx` to produce the cut file before upload.
- Until then the ORIGINAL video is uploaded with the trim/mute intent stored; the UI
  states this plainly. No compression is faked.

### What is verifiable without a device
`tsc --noEmit` passes for all editor code (it is written against the real module
types). Actual on-device rendering (Skia canvas, crop export, thumbnails, gestures,
60fps) can only be confirmed on a real Android/iOS build — do a smoke test of each
tool after the prebuild+rebuild above.
