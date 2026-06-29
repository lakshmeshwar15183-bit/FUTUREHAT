// FUTUREHAT mobile — Expo config plugin that makes `expo prebuild` regenerate a
// release signing config in android/app/build.gradle. Credentials are read from
// Gradle properties (FUTUREHAT_UPLOAD_*), which live in the user-global
// ~/.gradle/gradle.properties — never in the repo. If those props are absent the
// release build transparently falls back to debug signing (e.g. on CI smoke runs).
const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_SIGNING_BLOCK = `        release {
            if (project.hasProperty('FUTUREHAT_UPLOAD_STORE_FILE')) {
                storeFile file(FUTUREHAT_UPLOAD_STORE_FILE)
                storePassword FUTUREHAT_UPLOAD_STORE_PASSWORD
                keyAlias FUTUREHAT_UPLOAD_KEY_ALIAS
                keyPassword FUTUREHAT_UPLOAD_KEY_PASSWORD
            }
        }
    }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // 1) Append a `release` signing config to the signingConfigs block (once).
    if (!src.includes('FUTUREHAT_UPLOAD_STORE_FILE')) {
      src = src.replace(
        /(signingConfigs\s*\{[\s\S]*?keyPassword 'android'\s*\n\s*\}\s*)\n(\s*)\}/,
        `$1\n${RELEASE_SIGNING_BLOCK}`,
      );
    }

    // 2) Point the release buildType at the release signing config. Anchor on the
    //    template's unique "Caution!" comment so we only touch the release block.
    src = src.replace(
      /(signed-apk-android\.\s*\n\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('FUTUREHAT_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
