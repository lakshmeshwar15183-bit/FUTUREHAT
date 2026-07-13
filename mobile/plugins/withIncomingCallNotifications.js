/**
 * Expo config plugin — WhatsApp-class incoming call notifications on Android.
 *
 * When the app is killed, FCM data-only high-priority call messages wake the
 * process and this native service posts a NotificationCompat.CallStyle /
 * fullScreenIntent notification (Answer / Decline). Cancel messages dismiss it.
 *
 * Survives `expo prebuild` regenerating android/.
 */
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withMainApplication,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');

const PKG = 'dev.lakshmeshwar.futurehat';

const SERVICE_KT = `package ${PKG}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Intercepts FCM before Expo's default presentation so incoming calls get a
 * true full-screen / CallStyle notification even when the JS process is dead.
 */
class LumixoFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    val type = (data["type"] ?: data["kind"] ?: "").lowercase()
    val callId = data["callId"] ?: data["call_id"]

    if (type == "call" && !callId.isNullOrBlank()) {
      IncomingCallNotifier.show(
        this,
        callId = callId,
        conversationId = data["conversationId"] ?: data["conversation_id"] ?: "",
        title = data["senderName"] ?: data["title"] ?: "Incoming call",
        body = data["body"] ?: if ((data["video"] ?: "").equals("true", true)) "Incoming video call" else "Incoming voice call",
        video = (data["video"] ?: "").equals("true", true),
      )
      // Do not fall through — avoids double notification from Expo defaults.
      return
    }

    if ((type == "call_status" || type == "missed_call") && !callId.isNullOrBlank()) {
      IncomingCallNotifier.cancel(this, callId)
      if (type == "missed_call") {
        // Let Expo / system still present missed-call if notification payload exists.
        super.onMessageReceived(remoteMessage)
      }
      return
    }

    super.onMessageReceived(remoteMessage)
  }
}
`;

const NOTIFIER_KT = `package ${PKG}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

object IncomingCallNotifier {
  private const val CHANNEL_ID = "calls_fullscreen"
  private const val CHANNEL_NAME = "Incoming calls (full screen)"

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Full-screen incoming voice and video calls"
      setSound(sound, attrs)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 1000, 1000, 1000, 1000)
      setBypassDnd(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    nm.createNotificationChannel(ch)
  }

  private fun notifId(callId: String): Int = ("call:\$callId").hashCode()

  fun show(
    ctx: Context,
    callId: String,
    conversationId: String,
    title: String,
    body: String,
    video: Boolean,
  ) {
    ensureChannel(ctx)
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val openIntent = Intent(ctx, MainActivity::class.java).apply {
      action = "dev.lakshmeshwar.futurehat.INCOMING_CALL"
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra("incoming_call_id", callId)
      putExtra("conversation_id", conversationId)
      putExtra("call_video", video)
      data = android.net.Uri.parse("futurehat://call/\$callId")
    }
    val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val fullScreenPi = PendingIntent.getActivity(ctx, notifId(callId), openIntent, piFlags)
    val contentPi = PendingIntent.getActivity(ctx, notifId(callId) + 1, openIntent, piFlags)

    val acceptIntent = Intent(ctx, MainActivity::class.java).apply {
      action = "dev.lakshmeshwar.futurehat.CALL_ACCEPT"
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("incoming_call_id", callId)
      putExtra("conversation_id", conversationId)
      putExtra("call_video", video)
      putExtra("call_action", "accept")
    }
    val declineIntent = Intent(ctx, MainActivity::class.java).apply {
      action = "dev.lakshmeshwar.futurehat.CALL_DECLINE"
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("incoming_call_id", callId)
      putExtra("conversation_id", conversationId)
      putExtra("call_action", "decline")
    }
    val acceptPi = PendingIntent.getActivity(ctx, notifId(callId) + 2, acceptIntent, piFlags)
    val declinePi = PendingIntent.getActivity(ctx, notifId(callId) + 3, declineIntent, piFlags)

    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName).let {
        if (it != 0) it else android.R.drawable.stat_sys_phone_call
      })
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(60_000L)
      .setFullScreenIntent(fullScreenPi, true)
      .setContentIntent(contentPi)
      .setVibrate(longArrayOf(0, 1000, 1000, 1000, 1000))
      .setColor(0xFF00A884.toInt())
      .addAction(0, "Decline", declinePi)
      .addAction(0, "Answer", acceptPi)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val person = Person.Builder().setName(title).setImportant(true).build()
      try {
        builder.setStyle(
          NotificationCompat.CallStyle.forIncomingCall(person, declinePi, acceptPi)
        )
      } catch (_: Throwable) {
        // CallStyle may be unavailable on some OEMs — actions still present.
      }
    }

    nm.notify(notifId(callId), builder.build())
  }

  fun cancel(ctx: Context, callId: String?) {
    if (callId.isNullOrBlank()) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.cancel(notifId(callId))
  }
}

@ReactModule(name = "IncomingCall")
class IncomingCallModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {
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
      IncomingCallNotifier.show(ctx, callId, conversationId, title, body, video)
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
}
`;

const PACKAGE_KT = `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class IncomingCallPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(IncomingCallModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function writeSources(projectRoot) {
  const javaDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...PKG.split('.'),
  );
  fs.mkdirSync(javaDir, { recursive: true });
  // Prefer checked-in production sources (WhatsApp-class Decline/Mute/Answer).
  // Fall back to embedded templates only if sources are missing (fresh prebuild).
  const srcDir = javaDir;
  const prefer = (name, fallback) => {
    const p = path.join(srcDir, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 200) {
      // Keep existing hand-maintained production Kotlin.
      return;
    }
    fs.writeFileSync(p, fallback);
  };
  prefer('LumixoFirebaseMessagingService.kt', SERVICE_KT);
  prefer('IncomingCallNotifier.kt', NOTIFIER_KT);
  prefer('IncomingCallPackage.kt', PACKAGE_KT);
  // IncomingCallActionReceiver lives inside IncomingCallNotifier.kt in production.
}

function withIncomingCallNotifications(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      writeSources(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

  // App module must depend on firebase-messaging so LumixoFirebaseMessagingService
  // can resolve RemoteMessage / FirebaseMessagingService (expo-notifications uses
  // implementation scope, so it is not on the app compile classpath).
  config = withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('com.google.firebase:firebase-messaging')) {
      src = src.replace(
        /dependencies\s*\{\s*\n/,
        `dependencies {\n    // Required by LumixoFirebaseMessagingService (extends Expo FCM service).\n    implementation("com.google.firebase:firebase-messaging:24.0.1")\n`,
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('IncomingCallPackage')) {
      if (src.includes('AppIconPackage()')) {
        src = src.replace(
          'packages.add(AppIconPackage())',
          'packages.add(AppIconPackage())\n            packages.add(IncomingCallPackage())',
        );
      } else {
        src = src.replace(
          /val packages = PackageList\(this\)\.packages/,
          'val packages = PackageList(this).packages\n            packages.add(IncomingCallPackage())',
        );
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return cfg;

    app.service = app.service || [];
    // Prefer our service for FCM; remove default expo FCM service entries if present
    // and register LumixoFirebaseMessagingService.
    const services = app.service.filter((s) => {
      const name = s.$?.['android:name'] || '';
      return !name.includes('ExpoFirebaseMessagingService') && !name.includes('LumixoFirebaseMessagingService');
    });

    services.push({
      $: {
        'android:name': `.LumixoFirebaseMessagingService`,
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }],
        },
      ],
    });
    app.service = services;

    // Decline / Mute BroadcastReceiver (must not launch MainActivity).
    app.receiver = app.receiver || [];
    app.receiver = app.receiver.filter(
      (r) => !(r.$?.['android:name'] || '').includes('IncomingCallActionReceiver'),
    );
    app.receiver.push({
      $: {
        'android:name': '.IncomingCallActionReceiver',
        'android:exported': 'false',
        'android:enabled': 'true',
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'dev.lakshmeshwar.futurehat.CALL_DECLINE' } },
            { $: { 'android:name': 'dev.lakshmeshwar.futurehat.CALL_MUTE' } },
          ],
        },
      ],
    });

    // Ensure USE_FULL_SCREEN_INTENT is present
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const perms = new Set(
      (manifest['uses-permission'] || []).map((p) => p.$?.['android:name']).filter(Boolean),
    );
    for (const p of [
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
    ]) {
      if (!perms.has(p)) {
        manifest['uses-permission'].push({ $: { 'android:name': p } });
      }
    }

    return cfg;
  });

  return config;
}

module.exports = withIncomingCallNotifications;
