package dev.lakshmeshwar.futurehat

import android.app.Activity
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Reliable system light/dark observation for Lumixo.
 *
 * React Native's Appearance API is flaky on several OEMs (Realme/ColorOS, MIUI,
 * Oppo) when the user toggles dark mode while the app is open. This module
 * reads [Configuration.UI_MODE_NIGHT_MASK] directly and emits
 * `systemColorSchemeChanged` whenever the activity/application receives a
 * configuration change — so Follow System can retheme without restart.
 */
class SystemThemeModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getColorScheme(promise: Promise) {
    try {
      promise.resolve(schemeFrom(ctx.resources.configuration))
    } catch (t: Throwable) {
      promise.resolve("light")
    }
  }

  /**
   * Apply status + navigation bar chrome to match Lumixo's active palette.
   * isLightContent false → light icons on dark bar (dark theme).
   * isLightContent true → dark icons on light bar (light theme).
   */
  @ReactMethod
  fun setSystemChrome(
    isLightSurfaces: Boolean,
    statusBarColor: String?,
    navigationBarColor: String?,
    promise: Promise,
  ) {
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    activity.runOnUiThread {
      try {
        val window = activity.window
        // Draw behind system bars so we control colors without white flash.
        WindowCompat.setDecorFitsSystemWindows(window, true)
        if (statusBarColor != null) {
          try {
            window.statusBarColor = Color.parseColor(statusBarColor)
          } catch (_: Throwable) { /* ignore bad hex */ }
        }
        if (navigationBarColor != null) {
          try {
            window.navigationBarColor = Color.parseColor(navigationBarColor)
          } catch (_: Throwable) { /* ignore */ }
        }

        val controller = WindowInsetsControllerCompat(window, window.decorView)
        // Light surfaces → dark status/nav glyphs; dark surfaces → light glyphs.
        controller.isAppearanceLightStatusBars = isLightSurfaces
        controller.isAppearanceLightNavigationBars = isLightSurfaces

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
          @Suppress("DEPRECATION")
          var flags = window.decorView.systemUiVisibility
          flags = if (isLightSurfaces) {
            flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
          } else {
            flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = if (isLightSurfaces) {
              flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            } else {
              flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            }
          }
          @Suppress("DEPRECATION")
          window.decorView.systemUiVisibility = flags
        }

        // Avoid forced contrast overlays flashing white/black mid-transition.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          window.isNavigationBarContrastEnforced = false
          window.isStatusBarContrastEnforced = false
        }

        promise.resolve(true)
      } catch (t: Throwable) {
        promise.resolve(false)
      }
    }
  }

  // Required for NativeEventEmitter on RN 0.65+
  @ReactMethod
  fun addListener(eventName: String) {
    // no-op
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // no-op
  }

  companion object {
    const val NAME = "LumixoSystemTheme"
    const val EVENT = "systemColorSchemeChanged"

    @Volatile
    private var lastEmitted: String? = null

    @Volatile
    private var reactCtx: ReactApplicationContext? = null

    fun attach(ctx: ReactApplicationContext) {
      reactCtx = ctx
    }

    fun schemeFrom(config: Configuration): String {
      val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK
      return if (night == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    /**
     * Call from MainActivity / MainApplication onConfigurationChanged.
     * Debounces identical schemes so we don't re-render the JS tree needlessly.
     */
    fun emitConfiguration(config: Configuration) {
      val scheme = schemeFrom(config)
      if (scheme == lastEmitted) return
      lastEmitted = scheme
      val rc = reactCtx ?: return
      if (!rc.hasActiveReactInstance()) return
      try {
        val map: WritableMap = Arguments.createMap()
        map.putString("colorScheme", scheme)
        rc
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT, map)
      } catch (_: Throwable) {
        // JS not ready — ignore
      }
    }

    /** Force re-emit even if scheme unchanged (e.g. app resume). */
    fun emitForce(config: Configuration) {
      lastEmitted = null
      emitConfiguration(config)
    }
  }

  init {
    attach(ctx)
  }
}
