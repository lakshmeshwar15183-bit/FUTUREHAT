// FUTUREHAT mobile — notification engine. WhatsApp-style Android channels + local
// notification presentation. Sounds are the DEVICE SYSTEM DEFAULT (channel
// `sound: 'default'`) — nothing is bundled and no picker is shown; users tune a
// channel's sound/vibration/LED from Android's own per-channel settings. Killed-
// state delivery rides FCM (registerForPush → push Edge Function); these local
// presenters cover app open / background / minimized (JS alive).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { registerPushToken } from './shared';

// Bump when channel definitions change so they're re-created once (never every launch).
const CHANNELS_VERSION = '2';
const CHANNELS_KEY = 'fh:channelsVersion';

export const CHANNELS = {
  messages: 'messages',
  groups: 'group_messages',
  calls: 'calls',
  missedCalls: 'missed_calls',
  status: 'status',
  system: 'admin_system',
} as const;

export const CATEGORY = { message: 'fh_message', call: 'fh_call' } as const;

const LED = '#00A884';

// Foreground behaviour: show the banner + play the (system default) sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let initialized = false;
let pushActive = false;                 // true once an FCM token is registered
let openConversationId: string | null = null;

/** True when FCM is configured + a device token was registered (killed-state push
 *  is live) — the local realtime notifier steps aside to avoid duplicates. */
export function isPushActive(): boolean { return pushActive; }

/** ChatScreen calls this on focus/blur so we never notify for the open chat. */
export function setOpenConversation(id: string | null): void { openConversationId = id; }
export function getOpenConversation(): string | null { return openConversationId; }

/** Create the six channels once + register action categories. Idempotent. */
export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Action categories (buttons). Reply is a text-input action.
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY.message, [
      { identifier: 'reply', buttonTitle: 'Reply', textInput: { submitButtonTitle: 'Send', placeholder: 'Message' } },
      { identifier: 'mark_read', buttonTitle: 'Mark as read' },
      { identifier: 'open', buttonTitle: 'Open chat' },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.call, [
      { identifier: 'accept', buttonTitle: 'Accept' },
      { identifier: 'decline', buttonTitle: 'Decline', options: { isDestructive: true } },
    ]);
  } catch { /* categories are best-effort */ }

  if (Platform.OS !== 'android') return;

  const done = await AsyncStorage.getItem(CHANNELS_KEY).catch(() => null);
  if (done === CHANNELS_VERSION) return;   // already created this version

  const I = Notifications.AndroidImportance;
  try {
    await Notifications.setNotificationChannelAsync(CHANNELS.messages, {
      name: 'Messages', importance: I.MAX, sound: 'default',
      vibrationPattern: [0, 250, 250, 250], enableVibrate: true, enableLights: true, lightColor: LED,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, showBadge: true,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.groups, {
      name: 'Group Messages', importance: I.HIGH, sound: 'default',
      vibrationPattern: [0, 250, 250, 250], enableVibrate: true, enableLights: true, lightColor: LED, showBadge: true,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.calls, {
      name: 'Calls', importance: I.MAX, sound: 'default',
      vibrationPattern: [0, 1000, 800, 1000, 800, 1000], enableVibrate: true, enableLights: true, lightColor: LED,
      bypassDnd: true, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.missedCalls, {
      name: 'Missed Calls', importance: I.HIGH, sound: 'default',
      vibrationPattern: [0, 300], enableVibrate: true, enableLights: true, lightColor: LED,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.status, {
      name: 'Status', importance: I.LOW, sound: 'default', enableVibrate: false, showBadge: false,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.system, {
      name: 'Admin / System', importance: I.HIGH, sound: 'default', enableVibrate: true, enableLights: true, lightColor: LED,
    });
    await AsyncStorage.setItem(CHANNELS_KEY, CHANNELS_VERSION);
  } catch { /* channel creation best-effort */ }
}

/** Ask for POST_NOTIFICATIONS (Android 13+) and register the FCM token. Best-effort. */
export async function registerForPush(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
    if (!granted) return;
    // Raw FCM device token — sent directly by our push Edge Function (FCM v1).
    const token = await Notifications.getDevicePushTokenAsync();
    if (token?.data) {
      await registerPushToken(supabase, String(token.data), (token.type as any) ?? 'android');
      pushActive = true;
    }
  } catch { /* FCM not configured (no google-services.json) yet — ignore */ }
}

export interface MessageNotifOpts {
  conversationId: string;
  title: string;              // sender / group name
  body: string;               // message preview (already redacted if preview off)
  isGroup?: boolean;
  vibrate?: boolean;
}

/** Present a local message notification (app open / background). Grouped per chat. */
export async function presentMessageNotification(o: MessageNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `chat:${o.conversationId}`,     // same id → updates in place, no dupes
      content: {
        title: o.title,
        body: o.body,
        categoryIdentifier: CATEGORY.message,
        data: { type: 'message', conversationId: o.conversationId },
        ...(Platform.OS === 'android' ? { channelId: o.isGroup ? CHANNELS.groups : CHANNELS.messages } : {}),
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface CallNotifOpts {
  callId: string;
  conversationId: string;
  title: string;
  video?: boolean;
}

/** Present a high-priority incoming-call notification with Accept/Decline. */
export async function presentCallNotification(o: CallNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `call:${o.callId}`,
      content: {
        title: o.title,
        body: o.video ? 'Incoming video call' : 'Incoming voice call',
        categoryIdentifier: CATEGORY.call,
        data: { type: 'call', callId: o.callId, conversationId: o.conversationId, video: String(!!o.video) },
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.calls } : {}),
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

/** Clear a chat's notification when it's opened / read. */
export async function clearConversationNotification(conversationId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`chat:${conversationId}`); } catch { /* ignore */ }
}
export async function clearCallNotification(callId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`call:${callId}`); } catch { /* ignore */ }
}
