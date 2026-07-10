// Lumixo mobile — notification engine. WhatsApp-style Android channels + local
// notification presentation. Sounds are the DEVICE SYSTEM DEFAULT (channel
// `sound: 'default'`) — nothing is bundled and no picker is shown; users tune a
// channel's sound/vibration/LED from Android's own per-channel settings. Killed-
// state delivery rides FCM (registerForPush → push Edge Function); these local
// presenters cover app open / background / minimized (JS alive).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { registerPushToken, removePushToken } from './shared';

// Bump when channel definitions change so they're re-created once (never every launch).
const CHANNELS_VERSION = '2';
const CHANNELS_KEY = 'fh:channelsVersion';

export const CHANNELS = {
  messages: 'messages',
  groups: 'group_messages',
  calls: 'calls',
  missedCalls: 'missed_calls',
  status: 'status_replies',
  mentions: 'mentions',
  communities: 'communities',
  system: 'admin_system',
} as const;

export const CATEGORY = {
  message: 'fh_message',
  call: 'fh_call',
  status: 'fh_status',
  mention: 'fh_mention',
} as const;

const LED = '#00A884';

// Foreground behaviour: show the banner + play the (system default) sound — EXCEPT
// for the chat that's already open on screen (WhatsApp parity, no self-notify). This
// runs for BOTH locally-scheduled notifications and remote FCM messages that arrive
// while the app is foregrounded, so it's the single place we suppress the open chat.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    const convId = typeof data?.conversationId === 'string' ? data.conversationId : null;
    const suppress = data?.type === 'message' && convId != null && convId === openConversationId;
    return {
      shouldShowAlert: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: true,
    };
  },
});

let initialized = false;
let pushActive = false;                 // true once an FCM token is registered
let lastToken: string | null = null;    // most recent FCM device token (for refresh/unregister)
let openConversationId: string | null = null;

/** Notification response handler callback */
export type NotificationResponseHandler = (response: {
  type: string;
  action?: string;
  conversationId?: string;
  callId?: string;
  statusId?: string;
  replyText?: string;
}) => Promise<void>;

let notificationResponseHandler: NotificationResponseHandler | null = null;

/** Register a handler for notification responses (taps, actions) */
export function setNotificationResponseHandler(handler: NotificationResponseHandler | null): void {
  notificationResponseHandler = handler;
}

/** True when FCM is configured + a device token was registered (killed-state push
 *  is live) — the local realtime notifier steps aside to avoid duplicates. */
export function isPushActive(): boolean { return pushActive; }

/** ChatScreen calls this on focus/blur so we never notify for the open chat. */
export function setOpenConversation(id: string | null): void { openConversationId = id; }
export function getOpenConversation(): string | null { return openConversationId; }

/** Listen for notification responses (user taps notification or action button). */
export function startNotificationResponseListener(): () => void {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const action = response.actionIdentifier;

      if (notificationResponseHandler) {
        notificationResponseHandler({
          type: typeof data?.type === 'string' ? data.type : 'unknown',
          action: action === 'android.reply' ? 'reply' : action,
          conversationId: typeof data?.conversationId === 'string' ? data.conversationId : undefined,
          callId: typeof data?.callId === 'string' ? data.callId : undefined,
          statusId: typeof data?.statusId === 'string' ? data.statusId : undefined,
          replyText: typeof response.userText === 'string' ? response.userText : undefined,
        }).catch(console.error);
      }
    });
    return () => { try { sub.remove(); } catch { /* ignore */ } };
  } catch {
    return () => {};
  }
}

/** Create the channels once + register action categories. Idempotent. */
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
    await Notifications.setNotificationCategoryAsync(CATEGORY.status, [
      { identifier: 'reply', buttonTitle: 'Reply', textInput: { submitButtonTitle: 'Send', placeholder: 'Your reply' } },
      { identifier: 'open', buttonTitle: 'View status' },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.mention, [
      { identifier: 'reply', buttonTitle: 'Reply', textInput: { submitButtonTitle: 'Send', placeholder: 'Your message' } },
      { identifier: 'open', buttonTitle: 'Open group' },
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
      name: 'Status Replies', importance: I.HIGH, sound: 'default',
      vibrationPattern: [0, 250, 250, 250], enableVibrate: true, enableLights: true, lightColor: LED, showBadge: true,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.mentions, {
      name: 'Mentions', importance: I.MAX, sound: 'default',
      vibrationPattern: [0, 250, 250, 250], enableVibrate: true, enableLights: true, lightColor: LED, showBadge: true,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.communities, {
      name: 'Communities', importance: I.HIGH, sound: 'default',
      vibrationPattern: [0, 250, 250, 250], enableVibrate: true, enableLights: true, lightColor: LED, showBadge: true,
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
      lastToken = String(token.data);
      await registerPushToken(supabase, lastToken, (token.type as any) ?? 'android');
      pushActive = true;
    }
  } catch { /* FCM not configured (no google-services.json) yet — ignore */ }
}

// FCM rotates device tokens (app data cleared, restore, periodic refresh). Keep the
// server registry current so pushes never silently stop. Call once; returns an
// unsubscribe. Safe no-op if FCM isn't configured.
export function startPushTokenRefresh(): () => void {
  try {
    const sub = Notifications.addPushTokenListener((t) => {
      const next = String((t as any)?.data ?? '');
      if (!next || next === lastToken) return;
      lastToken = next;
      pushActive = true;
      registerPushToken(supabase, next, ((t as any)?.type as any) ?? 'android').catch(() => {});
    });
    return () => { try { sub.remove(); } catch { /* ignore */ } };
  } catch {
    return () => {};
  }
}

/** Drop this device's token on sign-out so a shared phone doesn't keep receiving the
 *  previous user's messages until the next login re-registers. Best-effort. */
export async function unregisterForPush(): Promise<void> {
  try {
    const token = lastToken ?? String((await Notifications.getDevicePushTokenAsync())?.data ?? '');
    if (token) await removePushToken(supabase, token);
  } catch { /* ignore */ }
  finally { lastToken = null; pushActive = false; }
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

export interface StatusReplyNotifOpts {
  statusId: string;
  statusOwnerId: string;
  title: string;  // who replied
  body: string;   // reply preview
}

/** Status reply notification */
export async function presentStatusReplyNotification(o: StatusReplyNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `status:${o.statusId}`,
      content: {
        title: o.title,
        body: o.body,
        categoryIdentifier: CATEGORY.status,
        data: { type: 'status_reply', statusId: o.statusId, statusOwnerId: o.statusOwnerId },
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.status } : {}),
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface MentionNotifOpts {
  conversationId: string;
  groupName: string;
  mentioner: string;
  body: string;
}

/** Group mention notification */
export async function presentMentionNotification(o: MentionNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `mention:${o.conversationId}`,
      content: {
        title: `${o.mentioner} in ${o.groupName}`,
        body: o.body,
        categoryIdentifier: CATEGORY.mention,
        data: { type: 'mention', conversationId: o.conversationId },
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.mentions } : {}),
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface MissedCallNotifOpts {
  callId: string;
  conversationId: string;
  title: string;
  isVideo?: boolean;
}

/** Missed call notification (when not answered in time) */
export async function presentMissedCallNotification(o: MissedCallNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `missed:${o.callId}`,
      content: {
        title: `Missed ${o.isVideo ? 'video' : 'voice'} call from ${o.title}`,
        body: 'Tap to call back',
        data: { type: 'missed_call', callId: o.callId, conversationId: o.conversationId },
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.missedCalls } : {}),
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface CommunityNotifOpts {
  communityId: string;
  communityName: string;
  title: string;  // announcement or event
  body: string;
}

/** Community announcement notification */
export async function presentCommunityNotification(o: CommunityNotifOpts): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `community:${o.communityId}`,
      content: {
        title: `${o.communityName}: ${o.title}`,
        body: o.body,
        data: { type: 'community_announcement', communityId: o.communityId },
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.communities } : {}),
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

export async function clearStatusReplyNotification(statusId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`status:${statusId}`); } catch { /* ignore */ }
}

export async function clearMentionNotification(conversationId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`mention:${conversationId}`); } catch { /* ignore */ }
}

export async function clearMissedCallNotification(callId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`missed:${callId}`); } catch { /* ignore */ }
}

export async function clearCommunityNotification(communityId: string): Promise<void> {
  try { await Notifications.dismissNotificationAsync(`community:${communityId}`); } catch { /* ignore */ }
}
