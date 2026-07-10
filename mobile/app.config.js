// FUTUREHAT — dynamic Expo config. app.json holds the full static config; this layer
// only ADDS the native Firebase files needed for FCM push, and ONLY when they're
// actually present. That way the repo builds fine before you add the credentials, and
// the moment you drop in google-services.json / GoogleService-Info.plist, the next
// native build wires up FCM automatically — no app.json edit required.
//
// To enable killed-state push (see WORK_LOG.md → "Manual setup"):
//   1. Firebase console → add an Android app with package `dev.lakshmeshwar.futurehat`,
//      download `google-services.json` into this `mobile/` folder.
//   2. (iOS) add an iOS app with bundle id `dev.lakshmeshwar.futurehat`, upload your
//      APNs key in Firebase, download `GoogleService-Info.plist` into `mobile/`.
//   3. Rebuild the native app (EAS build / expo run) so the files are embedded.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const here = (f) => path.join(__dirname, f);
  const androidGoogleServices = here('google-services.json');
  const iosGoogleServices = here('GoogleService-Info.plist');

  const android = { ...(config.android || {}) };
  const ios = { ...(config.ios || {}) };

  if (fs.existsSync(androidGoogleServices)) {
    android.googleServicesFile = './google-services.json';
  }
  if (fs.existsSync(iosGoogleServices)) {
    ios.googleServicesFile = './GoogleService-Info.plist';
  }

  return { ...config, android, ios };
};
