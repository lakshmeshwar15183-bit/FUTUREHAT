package dev.lakshmeshwar.futurehat

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * Battery / background-activity helper for Lumixo.
 * - Reads whether the app is exempt from battery optimizations (when available).
 * - Opens the best manufacturer-specific settings page, with safe fallbacks.
 * Never throws to JS; failures resolve as false / falsey maps.
 */
class BatteryAssistantModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "LumixoBatteryAssistant"

  private fun pkg(): String = ctx.packageName

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      val map: WritableMap = Arguments.createMap()
      map.putString("manufacturer", Build.MANUFACTURER ?: "")
      map.putString("brand", Build.BRAND ?: "")
      map.putString("model", Build.MODEL ?: "")
      map.putInt("sdk", Build.VERSION.SDK_INT)

      var ignoring = false
      var known = false
      try {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          ignoring = pm.isIgnoringBatteryOptimizations(pkg())
          known = true
        }
      } catch (_: Throwable) {
        known = false
      }
      map.putBoolean("ignoringBatteryOptimizations", ignoring)
      map.putBoolean("statusKnown", known)
      // Alias for product language ("background activity allowed")
      map.putBoolean("backgroundAllowed", if (known) ignoring else false)
      promise.resolve(map)
    } catch (t: Throwable) {
      try {
        val map = Arguments.createMap()
        map.putBoolean("ignoringBatteryOptimizations", false)
        map.putBoolean("statusKnown", false)
        map.putBoolean("backgroundAllowed", false)
        map.putString("error", t.message ?: "unknown")
        promise.resolve(map)
      } catch (_: Throwable) {
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun openBatterySettings(promise: Promise) {
    try {
      val opened = openBestSettings()
      promise.resolve(opened)
    } catch (t: Throwable) {
      // Last resort: never crash the app
      try {
        promise.resolve(tryOpen(appDetailsIntent()))
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }
  }

  private fun openBestSettings(): Boolean {
    val brand = ((Build.MANUFACTURER ?: "") + " " + (Build.BRAND ?: "")).lowercase()

    val candidates = mutableListOf<Intent>()

    when {
      brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> {
        candidates += intentActivity("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
        candidates += intentAction("miui.intent.action.POWER_HIDE_MODE_APP_LIST")
        candidates += intentAction("miui.intent.action.OP_AUTO_START")
        candidates += intentPackage("com.miui.powerkeeper")
      }
      brand.contains("oppo") || brand.contains("realme") -> {
        candidates += intentActivity("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
        candidates += intentActivity("com.oplus.battery", "com.oplus.powermanager.fuelgaue.PowerControlActivity")
        candidates += intentActivity("com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity")
        candidates += intentPackage("com.coloros.safecenter")
        candidates += intentPackage("com.oplus.battery")
      }
      brand.contains("vivo") || brand.contains("iqoo") -> {
        candidates += intentActivity("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
        candidates += intentActivity("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
        candidates += intentPackage("com.vivo.permissionmanager")
      }
      brand.contains("oneplus") || brand.contains("oppo") -> {
        // OnePlus / OxygenOS share some ColorOS surfaces
        candidates += intentActivity("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
        candidates += intentPackage("com.oneplus.security")
      }
      brand.contains("samsung") -> {
        candidates += intentActivity("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity")
        candidates += intentActivity("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity")
        candidates += intentPackage("com.samsung.android.lool")
      }
      brand.contains("huawei") || brand.contains("honor") -> {
        candidates += intentActivity("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
        candidates += intentActivity("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")
        candidates += intentPackage("com.huawei.systemmanager")
      }
      brand.contains("nothing") -> {
        candidates += intentPackage("com.nothing.hearthstone")
      }
      brand.contains("motorola") || brand.contains("moto") -> {
        // Generic battery screens below
      }
    }

    // Standard Android paths — never force REQUEST_IGNORE dialog (policy + UX).
    // Let the user choose Unrestricted themselves in settings.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      candidates += Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    }
    candidates += appDetailsIntent()
    candidates += Intent(Settings.ACTION_APPLICATION_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    candidates += Intent(Settings.ACTION_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    for (intent in candidates) {
      if (tryOpen(intent)) return true
    }
    return false
  }

  private fun appDetailsIntent(): Intent {
    return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
      data = Uri.parse("package:${pkg()}")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
  }

  private fun intentAction(action: String): Intent {
    return Intent(action).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        putExtra("package_name", pkg())
        putExtra("packageName", pkg())
        putExtra("packages", arrayOf(pkg()))
      } catch (_: Throwable) { /* ignore */ }
    }
  }

  private fun intentPackage(packageName: String): Intent {
    return Intent().apply {
      setPackage(packageName)
      action = Intent.ACTION_MAIN
      addCategory(Intent.CATEGORY_LAUNCHER)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
  }

  private fun intentActivity(packageName: String, className: String): Intent {
    return Intent().apply {
      component = ComponentName(packageName, className)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        putExtra("package_name", pkg())
        putExtra("packageName", pkg())
      } catch (_: Throwable) { /* ignore */ }
    }
  }

  private fun tryOpen(intent: Intent): Boolean {
    return try {
      val pm = ctx.packageManager
      val resolved = intent.resolveActivity(pm) != null
      if (!resolved) {
        // Some OEM intents resolve only via startActivity; still attempt.
        val acts = pm.queryIntentActivities(intent, 0)
        if (acts.isNullOrEmpty() && intent.component == null) return false
      }
      ctx.startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }
}
