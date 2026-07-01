#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FUTUREHAT — end-to-end call test launcher.
#
# ONE command that, the moment an Android phone is connected, builds v1.3.4 (the
# build carrying the call fix), installs + launches it, and streams the `[call]`
# signaling/ICE diagnostics to a timestamped log file so every stage of a real
# voice/video call is captured as evidence.
#
# Usage:
#   scripts/run-call-test.sh                 # build (release) + install + launch + capture logs
#   BUILD=debug   scripts/run-call-test.sh   # debug build (needs Metro; shows all console.log)
#   BUILD=skip    scripts/run-call-test.sh   # skip build, install existing release APK + capture
#   LOGONLY=1     scripts/run-call-test.sh   # don't build/install; just tail [call] logs from devices
#
# Notes:
#  * Install to BOTH phones (run once with both connected) to test a real 2-party call.
#  * Release build is self-contained → survives the network drop/reconnect test
#    (debug needs a live Metro connection and would break when you toggle the network).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."   # → mobile/

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
# JDK 17 (installed via `brew install openjdk@17`) — required by Gradle 8.8.
if [ -d /opt/homebrew/opt/openjdk@17 ]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

ADB="$ANDROID_HOME/platform-tools/adb"
BUILD="${BUILD:-release}"
LOGDIR="$(pwd)/call-test-logs"
mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

hr(){ printf '─%.0s' {1..70}; echo; }

# ── 0. Preconditions ────────────────────────────────────────────────────────
hr; echo "FUTUREHAT call test — $STAMP"; hr
if ! command -v java >/dev/null 2>&1 && [ -z "${JAVA_HOME:-}" ]; then
  echo "✗ No JDK. Run:  brew install openjdk@17   (then re-run this script)"; exit 1
fi
echo "• JAVA_HOME = ${JAVA_HOME:-<system java>}"
echo "• ANDROID_HOME = $ANDROID_HOME"

DEVICES=$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1}')
NDEV=$(echo "$DEVICES" | grep -c . || true)
if [ "$NDEV" -eq 0 ]; then
  hr
  echo "✗ NO ANDROID DEVICE CONNECTED — cannot run a live call."
  echo "  1. Enable Developer Options + USB debugging on the phone."
  echo "  2. Plug it in via USB and accept the 'Allow USB debugging' prompt."
  echo "  3. Confirm it shows here:  $ADB devices"
  echo "  4. Re-run:  scripts/run-call-test.sh"
  echo
  echo "  For a real 2-party call, connect BOTH phones and run once."
  exit 1
fi
echo "• Devices ($NDEV):"; echo "$DEVICES" | sed 's/^/    /'
hr

# ── 1. Build (unless skipped) ───────────────────────────────────────────────
APK="android/app/build/outputs/apk/release/app-release.apk"
if [ "${LOGONLY:-0}" = "1" ]; then
  echo "• LOGONLY — skipping build/install"
elif [ "$BUILD" = "skip" ]; then
  echo "• BUILD=skip — installing existing APK: $APK"
elif [ "$BUILD" = "debug" ]; then
  echo "• Building + installing DEBUG (Metro required in another terminal: npx expo start)"
  npx expo run:android --variant debug
else
  echo "• Building RELEASE (self-contained; survives network-toggle test)…"
  ( cd android && ./gradlew :app:assembleRelease )
  echo "• Built: $APK"
fi

# ── 2. Install + launch on every device ─────────────────────────────────────
PKG="dev.lakshmeshwar.futurehat"
if [ "${LOGONLY:-0}" != "1" ] && [ "$BUILD" != "debug" ]; then
  for d in $DEVICES; do
    echo "• [$d] installing…"; "$ADB" -s "$d" install -r -d "$APK"
    echo "• [$d] launching…"; "$ADB" -s "$d" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  done
fi

# ── 3. Capture [call] diagnostics per device ────────────────────────────────
# console.log('[call] …') from webrtc.ts surfaces under the ReactNativeJS tag.
# We also keep WebRTC-native lines (libwebrtc/org.webrtc) for ICE/media truth.
hr; echo "Capturing logs. Perform the call now. Ctrl-C to stop."; hr
PIDS=()
for d in $DEVICES; do
  f="$LOGDIR/call-$STAMP-${d//[^A-Za-z0-9]/_}.log"
  echo "• [$d] → $f"
  "$ADB" -s "$d" logcat -c || true
  ( "$ADB" -s "$d" logcat -v time 2>&1 \
      | grep --line-buffered -Ei '\[call\]|ReactNativeJS|libwebrtc|org\.webrtc|PeerConnection|IceCandidate|WebRTC' \
      | tee "$f" ) &
  PIDS+=($!)
done
trap 'echo; echo "Stopping capture…"; for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; echo "Logs saved under $LOGDIR/"; exit 0' INT TERM
wait
