package dev.lakshmeshwar.futurehat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject

/**
 * WhatsApp/Telegram-class incoming call notifications.
 *
 * Actions (exactly three, no duplicates):
 *  🔴 Decline — BroadcastReceiver only (never starts MainActivity)
 *  🔕 Mute   — BroadcastReceiver only (silence ring, keep notification)
 *  🟢 Answer — starts MainActivity (only path that foregrounds Lumixo)
 */
object IncomingCallNotifier {
  const val CHANNEL_RINGING = "calls_fullscreen"
  const val CHANNEL_MUTED = "calls_fullscreen_muted"
  private const val PREFS = "lumixo_incoming_calls"
  private const val KEY_ACTIVE = "active_calls_json"
  private const val KEY_PENDING = "pending_action_json"

  const val ACTION_DECLINE = "dev.lakshmeshwar.futurehat.CALL_DECLINE"
  const val ACTION_MUTE = "dev.lakshmeshwar.futurehat.CALL_MUTE"
  const val ACTION_ANSWER = "dev.lakshmeshwar.futurehat.CALL_ANSWER"
  const val ACTION_OPEN = "dev.lakshmeshwar.futurehat.INCOMING_CALL"

  const val EXTRA_CALL_ID = "incoming_call_id"
  const val EXTRA_CONV_ID = "conversation_id"
  const val EXTRA_VIDEO = "call_video"
  const val EXTRA_TITLE = "call_title"
  const val EXTRA_BODY = "call_body"
  const val EXTRA_MUTED = "call_muted"
  const val EXTRA_CALL_ACTION = "call_action"

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (nm.getNotificationChannel(CHANNEL_RINGING) == null) {
      val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_RINGING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Full-screen incoming voice and video calls"
          setSound(sound, attrs)
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 1000, 1000, 1000, 1000)
          setBypassDnd(true)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }

    if (nm.getNotificationChannel(CHANNEL_MUTED) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_MUTED, "Incoming calls (muted)", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Incoming call after mute — silent, still answerable"
          setSound(null, null)
          enableVibration(false)
          setBypassDnd(true)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }
  }

  fun notifId(callId: String): Int = ("call:$callId").hashCode() and 0x7FFFFFFF

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Persist active call meta so Mute can re-post without losing payload. */
  fun rememberCall(
    ctx: Context,
    callId: String,
    conversationId: String,
    title: String,
    body: String,
    video: Boolean,
    muted: Boolean,
  ) {
    val p = prefs(ctx)
    val root = try {
      JSONObject(p.getString(KEY_ACTIVE, "{}") ?: "{}")
    } catch (_: Throwable) {
      JSONObject()
    }
    root.put(
      callId,
      JSONObject().apply {
        put("conversationId", conversationId)
        put("title", title)
        put("body", body)
        put("video", video)
        put("muted", muted)
        put("at", System.currentTimeMillis())
      },
    )
    p.edit().putString(KEY_ACTIVE, root.toString()).apply()
  }

  fun forgetCall(ctx: Context, callId: String?) {
    if (callId.isNullOrBlank()) return
    val p = prefs(ctx)
    val root = try {
      JSONObject(p.getString(KEY_ACTIVE, "{}") ?: "{}")
    } catch (_: Throwable) {
      JSONObject()
    }
    root.remove(callId)
    p.edit().putString(KEY_ACTIVE, root.toString()).apply()
  }

  fun getCallMeta(ctx: Context, callId: String): JSONObject? {
    return try {
      val root = JSONObject(prefs(ctx).getString(KEY_ACTIVE, "{}") ?: "{}")
      if (root.has(callId)) root.getJSONObject(callId) else null
    } catch (_: Throwable) {
      null
    }
  }

  fun queuePendingAction(ctx: Context, action: String, callId: String, conversationId: String, video: Boolean) {
    val json = JSONObject().apply {
      put("action", action)
      put("callId", callId)
      put("conversationId", conversationId)
      put("video", video)
      put("at", System.currentTimeMillis())
    }
    prefs(ctx).edit().putString(KEY_PENDING, json.toString()).apply()
  }

  fun peekPendingAction(ctx: Context): String? =
    prefs(ctx).getString(KEY_PENDING, null)

  fun clearPendingAction(ctx: Context) {
    prefs(ctx).edit().remove(KEY_PENDING).apply()
  }

  /** Stop notification channel ringtone + device vibrator (best-effort). */
  fun stopRinging(ctx: Context) {
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      // Abandon focus so OEM ringtone from notification channel stops more reliably.
      am?.abandonAudioFocus(null)
    } catch (_: Throwable) { /* ignore */ }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vm?.defaultVibrator?.cancel()
      } else {
        @Suppress("DEPRECATION")
        (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
      }
    } catch (_: Throwable) { /* ignore */ }
  }

  private fun smallIcon(ctx: Context): Int {
    val id = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
    return if (id != 0) id else android.R.drawable.stat_sys_phone_call
  }

  private fun piFlags(): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun declineBroadcast(ctx: Context, callId: String, conversationId: String, video: Boolean): PendingIntent {
    val i = Intent(ctx, IncomingCallActionReceiver::class.java).apply {
      action = ACTION_DECLINE
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_CONV_ID, conversationId)
      putExtra(EXTRA_VIDEO, video)
      // Unique data so PendingIntents don't collide across calls
      data = android.net.Uri.parse("lumixo-call://decline/$callId")
    }
    return PendingIntent.getBroadcast(ctx, notifId(callId) + 11, i, piFlags())
  }

  private fun muteBroadcast(ctx: Context, callId: String, conversationId: String, video: Boolean): PendingIntent {
    val i = Intent(ctx, IncomingCallActionReceiver::class.java).apply {
      action = ACTION_MUTE
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_CONV_ID, conversationId)
      putExtra(EXTRA_VIDEO, video)
      data = android.net.Uri.parse("lumixo-call://mute/$callId")
    }
    return PendingIntent.getBroadcast(ctx, notifId(callId) + 12, i, piFlags())
  }

  private fun answerActivity(ctx: Context, callId: String, conversationId: String, video: Boolean): PendingIntent {
    val i = Intent(ctx, MainActivity::class.java).apply {
      action = ACTION_ANSWER
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_CONV_ID, conversationId)
      putExtra(EXTRA_VIDEO, video)
      putExtra(EXTRA_CALL_ACTION, "accept")
      data = android.net.Uri.parse("futurehat://call/$callId?action=answer")
    }
    return PendingIntent.getActivity(ctx, notifId(callId) + 13, i, piFlags())
  }

  private fun openActivity(ctx: Context, callId: String, conversationId: String, video: Boolean): PendingIntent {
    val i = Intent(ctx, MainActivity::class.java).apply {
      action = ACTION_OPEN
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_CONV_ID, conversationId)
      putExtra(EXTRA_VIDEO, video)
      putExtra(EXTRA_CALL_ACTION, "open")
      data = android.net.Uri.parse("futurehat://call/$callId")
    }
    return PendingIntent.getActivity(ctx, notifId(callId) + 14, i, piFlags())
  }

  fun show(
    ctx: Context,
    callId: String,
    conversationId: String,
    title: String,
    body: String,
    video: Boolean,
    muted: Boolean = false,
  ) {
    if (callId.isBlank()) return
    ensureChannels(ctx)
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    rememberCall(ctx, callId, conversationId, title, body, video, muted)

    val declinePi = declineBroadcast(ctx, callId, conversationId, video)
    val mutePi = muteBroadcast(ctx, callId, conversationId, video)
    val answerPi = answerActivity(ctx, callId, conversationId, video)
    val contentPi = openActivity(ctx, callId, conversationId, video)
    // Full-screen only when ringing (not muted) — lock-screen heads-up like WhatsApp.
    val fullScreenPi = if (!muted) contentPi else null

    val channel = if (muted) CHANNEL_MUTED else CHANNEL_RINGING
    val contentText = if (muted) "Muted · $body" else body

    val builder = NotificationCompat.Builder(ctx, channel)
      .setSmallIcon(smallIcon(ctx))
      .setContentTitle(title)
      .setContentText(contentText)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(muted)
      .setTimeoutAfter(60_000L)
      .setContentIntent(contentPi)
      .setDeleteIntent(declinePi) // swipe-away ≈ decline
      .setColor(0xFF00A884.toInt())
      .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))

    if (fullScreenPi != null) {
      builder.setFullScreenIntent(fullScreenPi, true)
    }
    if (!muted) {
      builder.setVibrate(longArrayOf(0, 1000, 1000, 1000, 1000))
    } else {
      builder.setSilent(true)
      builder.setVibrate(longArrayOf(0))
    }

    // Exactly 3 actions. On API 31+ CallStyle owns Decline+Answer; Mute is the only addAction.
    // On older APIs use three addAction buttons (no CallStyle) to avoid duplicates.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val person = Person.Builder().setName(title).setImportant(true).build()
      try {
        builder.setStyle(
          NotificationCompat.CallStyle.forIncomingCall(person, declinePi, answerPi),
        )
        // Mute as the single extra action (CallStyle already shows Decline / Answer).
        if (!muted) {
          builder.addAction(
            NotificationCompat.Action.Builder(0, "Mute", mutePi).build(),
          )
        }
      } catch (_: Throwable) {
        // CallStyle unavailable — fall through to classic actions.
        addClassicActions(builder, declinePi, mutePi, answerPi, muted)
      }
    } else {
      addClassicActions(builder, declinePi, mutePi, answerPi, muted)
    }

    nm.notify(notifId(callId), builder.build())
  }

  private fun addClassicActions(
    builder: NotificationCompat.Builder,
    declinePi: PendingIntent,
    mutePi: PendingIntent,
    answerPi: PendingIntent,
    muted: Boolean,
  ) {
    // Order: Decline · Mute · Answer (WhatsApp/Telegram-class)
    builder.addAction(0, "Decline", declinePi)
    if (!muted) {
      builder.addAction(0, "Mute", mutePi)
    }
    builder.addAction(0, "Answer", answerPi)
  }

  fun mute(ctx: Context, callId: String) {
    val meta = getCallMeta(ctx, callId) ?: return
    stopRinging(ctx)
    // Cancel then re-post on silent channel so the system ringtone stops.
    cancel(ctx, callId, forget = false)
    show(
      ctx = ctx,
      callId = callId,
      conversationId = meta.optString("conversationId", ""),
      title = meta.optString("title", "Incoming call"),
      body = meta.optString("body", "Incoming call"),
      video = meta.optBoolean("video", false),
      muted = true,
    )
  }

  fun cancel(ctx: Context, callId: String?, forget: Boolean = true) {
    if (callId.isNullOrBlank()) return
    stopRinging(ctx)
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.cancel(notifId(callId))
    // Also dismiss any expo-notifications id variant
    try {
      nm.cancel("call:$callId".hashCode())
    } catch (_: Throwable) { /* ignore */ }
    if (forget) forgetCall(ctx, callId)
  }

  fun cancelAll(ctx: Context) {
    stopRinging(ctx)
    val p = prefs(ctx)
    val root = try {
      JSONObject(p.getString(KEY_ACTIVE, "{}") ?: "{}")
    } catch (_: Throwable) {
      JSONObject()
    }
    val keys = root.keys()
    while (keys.hasNext()) {
      val id = keys.next()
      cancel(ctx, id, forget = false)
    }
    p.edit().putString(KEY_ACTIVE, "{}").apply()
  }
}

/**
 * Handles Decline / Mute without launching the app.
 * Answer is an activity PendingIntent and never routes here.
 */
class IncomingCallActionReceiver : android.content.BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent == null) return
    val callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID) ?: return
    val conversationId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CONV_ID) ?: ""
    val video = intent.getBooleanExtra(IncomingCallNotifier.EXTRA_VIDEO, false)

    when (intent.action) {
      IncomingCallNotifier.ACTION_DECLINE -> {
        // Critical: never start an Activity. Reject ring + clear tray immediately.
        IncomingCallNotifier.stopRinging(context)
        IncomingCallNotifier.cancel(context, callId)
        IncomingCallNotifier.cancelAll(context) // no stale call notifs
        IncomingCallNotifier.queuePendingAction(
          context,
          "decline",
          callId,
          conversationId,
          video,
        )
        IncomingCallModule.emitToJs(
          "IncomingCallAction",
          mapOf(
            "action" to "decline",
            "callId" to callId,
            "conversationId" to conversationId,
            "video" to video,
          ),
        )
      }
      IncomingCallNotifier.ACTION_MUTE -> {
        IncomingCallNotifier.mute(context, callId)
        IncomingCallModule.emitToJs(
          "IncomingCallAction",
          mapOf(
            "action" to "mute",
            "callId" to callId,
            "conversationId" to conversationId,
            "video" to video,
          ),
        )
      }
    }
  }
}

@ReactModule(name = "IncomingCall")
class IncomingCallModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  init {
    reactContextRef = ctx
  }

  override fun getName(): String = "IncomingCall"

  @ReactMethod
  fun showIncomingCall(
    callId: String,
    conversationId: String,
    title: String,
    body: String,
    video: Boolean,
    promise: Promise,
  ) {
    try {
      IncomingCallNotifier.show(ctx, callId, conversationId, title, body, video, muted = false)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_CALL_NOTIF", e.message, e)
    }
  }

  @ReactMethod
  fun cancelIncomingCall(callId: String, promise: Promise) {
    try {
      IncomingCallNotifier.cancel(ctx, callId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_CALL_CANCEL", e.message, e)
    }
  }

  @ReactMethod
  fun cancelAllIncomingCalls(promise: Promise) {
    try {
      IncomingCallNotifier.cancelAll(ctx)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_CALL_CANCEL_ALL", e.message, e)
    }
  }

  /** JS polls on resume / mount so killed-process Decline still rejects server-side. */
  @ReactMethod
  fun getPendingCallAction(promise: Promise) {
    try {
      val raw = IncomingCallNotifier.peekPendingAction(ctx)
      if (raw.isNullOrBlank()) {
        promise.resolve(null)
        return
      }
      val o = JSONObject(raw)
      val map = Arguments.createMap()
      map.putString("action", o.optString("action"))
      map.putString("callId", o.optString("callId"))
      map.putString("conversationId", o.optString("conversationId"))
      map.putBoolean("video", o.optBoolean("video", false))
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("E_PENDING", e.message, e)
    }
  }

  @ReactMethod
  fun clearPendingCallAction(promise: Promise) {
    try {
      IncomingCallNotifier.clearPendingAction(ctx)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_PENDING_CLEAR", e.message, e)
    }
  }

  companion object {
    @Volatile
    private var reactContextRef: ReactApplicationContext? = null

    fun emitToJs(event: String, payload: Map<String, Any?>) {
      val rc = reactContextRef ?: return
      if (!rc.hasActiveReactInstance()) return
      try {
        val map: WritableMap = Arguments.createMap()
        for ((k, v) in payload) {
          when (v) {
            null -> map.putNull(k)
            is String -> map.putString(k, v)
            is Boolean -> map.putBoolean(k, v)
            is Int -> map.putInt(k, v)
            is Double -> map.putDouble(k, v)
            is Long -> map.putDouble(k, v.toDouble())
            else -> map.putString(k, v.toString())
          }
        }
        rc
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, map)
      } catch (_: Throwable) {
        /* JS not ready — pending SharedPreferences remains source of truth */
      }
    }
  }
}
