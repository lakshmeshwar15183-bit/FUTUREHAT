# iOS alternate app icons (Lumixo)

Production assets for each icon live in:

- `AppIcon-icon1.appiconset` … `AppIcon-icon6.appiconset`

When the iOS target is generated (`npx expo prebuild --platform ios` or a full
Xcode project), wire alternate icons as follows:

1. Copy each `AppIcon-iconN.appiconset` into `ios/Lumixo/Images.xcassets/`.
2. In `Info.plist`, under `CFBundleIcons` → `CFBundleAlternateIcons`, add:

```xml
<key>icon2</key>
<dict>
  <key>CFBundleIconFiles</key>
  <array><string>AppIcon-icon2</string></array>
  <key>UIPrerenderedIcon</key>
  <false/>
</dict>
```

(Repeat for icon3–icon6. Primary/default remains Icon 1 / primary AppIcon.)

3. Expose `UIApplication.shared.setAlternateIconName` via a native module named
   `LumixoAppIcon` matching the Android bridge in
   `android/.../AppIconModule.kt` (`setIcon` / `getIcon`).

The JS API (`src/lib/appIcon.ts`) already calls `NativeModules.LumixoAppIcon`.
App name remains **Lumixo** for every icon.
