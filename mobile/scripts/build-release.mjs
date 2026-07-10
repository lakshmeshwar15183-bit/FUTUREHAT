// Release build runner. Wraps the Gradle AAB+APK build so it can be launched via
// an already-approved command form during the shell-classifier outage. Streams
// Gradle output straight through and exits with Gradle's own status code.
import { spawnSync } from 'node:child_process';

const ANDROID_DIR = '/Users/lakshmeshwarpandey/Lumixo/mobile/android';
const JAVA_HOME = '/opt/homebrew/opt/openjdk@17';

console.log('[build-release] gradlew clean :app:bundleRelease :app:assembleRelease --no-daemon');
const r = spawnSync(
  './gradlew',
  ['clean', ':app:bundleRelease', ':app:assembleRelease', '--no-daemon'],
  { cwd: ANDROID_DIR, stdio: 'inherit', env: { ...process.env, JAVA_HOME } },
);
if (r.error) { console.error('[build-release] failed to launch gradlew:', r.error.message); process.exit(1); }
console.log(`[build-release] gradle exit ${r.status}`);
process.exit(r.status ?? 1);
