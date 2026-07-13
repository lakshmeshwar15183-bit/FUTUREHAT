package dev.lakshmeshwar.futurehat

import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Switches the Android launcher icon via activity-aliases without killing the process.
 *
 * Critical order (prevents process death on most OEMs):
 *  1) No-op if already active
 *  2) ENABLE the target alias first (so a launcher component always exists)
 *  3) DISABLE the others with DONT_KILL_APP (deferred slightly so PM settles)
 *
 * Never disable the target before the replacement is enabled — that is the
 * primary cause of activity restarts when switching icons.
 *
 * Manifest aliases: dev.lakshmeshwar.futurehat.MainActivityIcon{1..6}
 */
class AppIconModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "LumixoAppIcon"

  private val icons = listOf("icon1", "icon2", "icon3", "icon4", "icon5", "icon6")
  private val mainHandler = Handler(Looper.getMainLooper())

  private fun componentFor(iconId: String): ComponentName {
    val suffix = iconId.removePrefix("icon").ifEmpty { "1" }
    return ComponentName(ctx, "dev.lakshmeshwar.futurehat.MainActivityIcon$suffix")
  }

  private fun activeIconId(pm: PackageManager): String {
    for (id in icons) {
      val state = pm.getComponentEnabledSetting(componentFor(id))
      if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
        return id
      }
      // DEFAULT means manifest android:enabled — Icon1 is enabled by default.
      if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && id == "icon1") {
        return "icon1"
      }
    }
    return "icon1"
  }

  @ReactMethod
  fun setIcon(iconName: String, promise: Promise) {
    try {
      val pm = ctx.packageManager
      val target = if (icons.contains(iconName)) iconName else "icon1"
      val current = activeIconId(pm)

      // Already matching — do not touch PackageManager (avoids restart/flicker).
      if (current == target) {
        promise.resolve(true)
        return
      }

      // 1) Enable the new launcher component FIRST.
      pm.setComponentEnabledSetting(
        componentFor(target),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP,
      )

      // 2) Disable the others after a short delay so we never have zero launchers
      //    and so the process is not tied to a component we immediately disable.
      mainHandler.postDelayed({
        try {
          for (id in icons) {
            if (id == target) continue
            pm.setComponentEnabledSetting(
              componentFor(id),
              PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
              PackageManager.DONT_KILL_APP,
            )
          }
        } catch (_: Exception) {
          // Best-effort; preference is already stored on the JS side.
        }
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
