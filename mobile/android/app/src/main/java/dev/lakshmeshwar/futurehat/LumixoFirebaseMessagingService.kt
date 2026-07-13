package dev.lakshmeshwar.futurehat

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

    if ((type == "call_status" || type == "missed_call" || type == "call_ended" || type == "call_cancel")
      && !callId.isNullOrBlank()
    ) {
      // Caller hung up / cancelled — kill ring + tray immediately (no stale notif).
      IncomingCallNotifier.stopRinging(this)
      IncomingCallNotifier.cancel(this, callId)
      IncomingCallModule.emitToJs(
        "IncomingCallAction",
        mapOf(
          "action" to "ended",
          "callId" to callId,
          "conversationId" to (data["conversationId"] ?: data["conversation_id"] ?: ""),
          "video" to false,
        ),
      )
      if (type == "missed_call") {
        // Let Expo / system still present missed-call if notification payload exists.
        super.onMessageReceived(remoteMessage)
      }
      return
    }

    super.onMessageReceived(remoteMessage)
  }
}
