// Lumixo — Expo config plugin: 6 alternate launcher icons + native switcher.
// Survives `expo prebuild` regenerating mobile/android (which is gitignored).
//
// Source assets live in mobile/assets/app-icons/ (committed).
// On prebuild this plugin:
//   1) Copies density mipmaps + adaptive XML into android/app/src/main/res
//   2) Adds activity-alias entries (MainActivityIcon1..6)
//   3) Writes AppIconModule.kt + AppIconPackage.kt
//   4) Registers AppIconPackage in MainApplication
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');

const PKG = 'dev.lakshmeshwar.futurehat';
const ICON_IDS = [1, 2, 3, 4, 5, 6];
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ensureAdaptiveXml(resRoot) {
  const anydpi = path.join(resRoot, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  for (const i of ICON_IDS) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_icon${i}_foreground"/>
</adaptive-icon>
`;
    fs.writeFileSync(path.join(anydpi, `ic_launcher_icon${i}.xml`), xml);
    fs.writeFileSync(path.join(anydpi, `ic_launcher_icon${i}_round.xml`), xml);
  }
}

function writeKotlinModules(projectRoot) {
  const javaDir = path.join(
    projectRoot,
    'android/app/src/main/java/dev/lakshmeshwar/futurehat',
  );
  fs.mkdirSync(javaDir, { recursive: true });

  fs.writeFileSync(
    path.join(javaDir, 'AppIconModule.kt'),
    `package ${PKG}

import android.content.ComponentName
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AppIconModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "LumixoAppIcon"
  private val icons = listOf("icon1", "icon2", "icon3", "icon4", "icon5", "icon6")

  private fun componentFor(iconId: String): ComponentName {
    val suffix = iconId.removePrefix("icon").ifEmpty { "1" }
    return ComponentName(ctx, "${PKG}.MainActivityIcon\$suffix")
  }

  @ReactMethod
  fun setIcon(iconName: String, promise: Promise) {
    try {
      val pm = ctx.packageManager
      val target = if (icons.contains(iconName)) iconName else "icon1"
      for (id in icons) {
        val state = if (id == target)
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        else
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        pm.setComponentEnabledSetting(componentFor(id), state, PackageManager.DONT_KILL_APP)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ICON_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getIcon(promise: Promise) {
    try {
      val pm = ctx.packageManager
      for (id in icons) {
        val state = pm.getComponentEnabledSetting(componentFor(id))
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
          promise.resolve(id)
          return
        }
      }
      promise.resolve("icon1")
    } catch (e: Exception) {
      promise.reject("ICON_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun supportsAlternateIcons(promise: Promise) {
    promise.resolve(true)
  }
}
`.replace('${PKG}', PKG).replace('MainActivityIcon\$suffix', 'MainActivityIcon$suffix'),
  );

  // Production module: enable-first, no-op if unchanged, deferred disable.
  // Survives prebuild; keep in sync with android/.../AppIconModule.kt.
  fs.writeFileSync(
    path.join(javaDir, 'AppIconModule.kt'),
    `package ${PKG}

import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Switches launcher icons via activity-aliases without killing the process.
 * Enable target FIRST, then disable others with DONT_KILL_APP (deferred).
 */
class AppIconModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "LumixoAppIcon"
  private val icons = listOf("icon1", "icon2", "icon3", "icon4", "icon5", "icon6")
  private val mainHandler = Handler(Looper.getMainLooper())

  private fun componentFor(iconId: String): ComponentName {
    val suffix = iconId.removePrefix("icon").ifEmpty { "1" }
    return ComponentName(ctx, "${PKG}.MainActivityIcon" + suffix)
  }

  private fun activeIconId(pm: PackageManager): String {
    for (id in icons) {
      val state = pm.getComponentEnabledSetting(componentFor(id))
      if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return id
      if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && id == "icon1") return "icon1"
    }
    return "icon1"
  }

  @ReactMethod
  fun setIcon(iconName: String, promise: Promise) {
    try {
      val pm = ctx.packageManager
      val target = if (icons.contains(iconName)) iconName else "icon1"
      if (activeIconId(pm) == target) {
        promise.resolve(true)
        return
      }
      // Enable replacement first so we never zero out launcher components.
      pm.setComponentEnabledSetting(
        componentFor(target),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP
      )
      mainHandler.postDelayed({
        try {
          for (id in icons) {
            if (id == target) continue
            pm.setComponentEnabledSetting(
              componentFor(id),
              PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
              PackageManager.DONT_KILL_APP
            )
          }
        } catch (_: Exception) { }
      }, 250)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ICON_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getIcon(promise: Promise) {
    try {
      promise.resolve(activeIconId(ctx.packageManager))
    } catch (e: Exception) {
      promise.reject("ICON_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun supportsAlternateIcons(promise: Promise) {
    promise.resolve(true)
  }
}
`,
  );

  fs.writeFileSync(
    path.join(javaDir, 'AppIconPackage.kt'),
    `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppIconPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(AppIconModule(reactContext))
  }
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`,
  );
}

function withAppIconAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const resRoot = path.join(projectRoot, 'android/app/src/main/res');
      // Copy pre-generated density folders from committed staging if present
      const staged = path.join(projectRoot, 'assets/app-icons/android-res');
      if (fs.existsSync(staged)) {
        for (const dens of [...DENSITIES, 'anydpi-v26']) {
          const from = path.join(staged, dens.startsWith('anydpi') ? `mipmap-${dens}` : `mipmap-${dens}`);
          const to = path.join(resRoot, dens.startsWith('anydpi') ? `mipmap-${dens}` : `mipmap-${dens}`);
          if (fs.existsSync(from)) copyDir(from, to);
        }
      }
      ensureAdaptiveXml(resRoot);
      writeKotlinModules(projectRoot);
      return cfg;
    },
  ]);
}

function withAppIconManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return cfg;

    // Strip LAUNCHER intent-filter from MainActivity (aliases own the launcher).
    const activities = app.activity || [];
    for (const act of activities) {
      const name = act.$?.['android:name'] || '';
      if (!name.endsWith('.MainActivity') && name !== '.MainActivity') continue;
      const filters = act['intent-filter'] || [];
      act['intent-filter'] = filters.filter((f) => {
        const actions = (f.action || []).map((a) => a.$?.['android:name']);
        const cats = (f.category || []).map((c) => c.$?.['android:name']);
        const isLauncher =
          actions.includes('android.intent.action.MAIN') &&
          cats.includes('android.intent.category.LAUNCHER');
        return !isLauncher;
      });
    }

    // Remove previous aliases we manage, then re-add.
    app['activity-alias'] = (app['activity-alias'] || []).filter((a) => {
      const n = a.$?.['android:name'] || '';
      return !/MainActivityIcon\d$/.test(n);
    });

    for (const i of ICON_IDS) {
      app['activity-alias'].push({
        $: {
          'android:name': `.MainActivityIcon${i}`,
          'android:enabled': i === 1 ? 'true' : 'false',
          'android:exported': 'true',
          'android:icon': `@mipmap/ic_launcher_icon${i}`,
          'android:roundIcon': `@mipmap/ic_launcher_icon${i}_round`,
          'android:label': '@string/app_name',
          'android:targetActivity': '.MainActivity',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          },
        ],
      });
    }

    return cfg;
  });
}

function withAppIconPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('AppIconPackage()')) {
      // Kotlin style PackageList
      if (src.includes('PackageList(this).packages')) {
        src = src.replace(
          /PackageList\(this\)\.packages/,
          'PackageList(this).packages.apply { add(AppIconPackage()) }',
        );
      } else if (src.includes('packages.add(new ModuleRegistryAdapter')) {
        // Java fallback
        src = src.replace(
          /List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);/,
          'List<ReactPackage> packages = new PackageList(this).getPackages();\n            packages.add(new AppIconPackage());',
        );
      } else {
        // Generic: add after getPackages packages variable
        src = src.replace(
          /(val packages = PackageList\(this\)\.packages)/,
          '$1\n            packages.add(AppIconPackage())',
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withAppIcons(config) {
  config = withAppIconAssets(config);
  config = withAppIconManifest(config);
  config = withAppIconPackage(config);
  return config;
};
