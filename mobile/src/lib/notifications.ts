// Lumixo mobile — production notification engine (WhatsApp-class).
//
// Architecture:
//   • Killed / Doze: FCM high-priority remote messages (push Edge Function).
//   • Foreground / background (JS alive): local presenters with stable ids so
//     FCM + local collapse to one tray entry per chat (`chat:<id>`).
//   • Calls: MAX channel + ringtone usage; silent data cancel clears ring UI.
//   • Grouping: per-chat counter → "5 new messages" body when stacked.
//   • Actions: Reply / Mark read / Mute / Archive (no app open required).
//
// Sounds use the DEVICE SYSTEM DEFAULT per Android channel — users customize
// in system Settings › Apps › Lumixo › Notifications.
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { registerPushToken, removePushToken } from './shared';
import { nativeCancelIncomingCall, nativeShowIncomingCall } from './incomingCallNative';
import { recordDelivery } from './notifLatency';
import { openBatteryAssistantSettings } from './batteryAssistant';

// Bump when channel definitions change so they're re-created once.
// v7: killed-app reliability — non-sticky call rings align with FCM cancel-by-tag.
const CHANNELS_VERSION = '7';
const CHANNELS_KEY = 'fh:channelsVersion';
const UNREAD_STACK_KEY = 'fh:notifStack'; // conversationId → { count, lastBody, title }

export const CHANNELS = {
  messages: 'messages',
  groups: 'group_messages',
  calls: 'calls',
  missedCalls: 'missed_calls',
  /** Silent sticky channel for ongoing in-call status (WhatsApp-class). */
  ongoingCall: 'ongoing_call',
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
const ACCENT = '#00A884';

// ── Foreground handler ──────────────────────────────────────────────────────
// Suppress system banner for the open chat; suppress sound for live calls
// (InCallManager owns the RING stream). Applies to local AND remote FCM.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    const convId = typeof data?.conversationId === 'string' ? data.conversationId : null;
    const type = typeof data?.type === 'string' ? data.type : '';
    const kind = typeof data?.kind === 'string' ? data.kind : '';

    if (type === 'call_status' || data?.silent === '1' || data?.silent === 1) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    const isCall = type === 'call' || kind === 'call';
    if (isCall) {
      // Foreground ring UI already owns the experience — no second system banner.
      // Native CallStyle still shows when backgrounded (FCM path).
      if (inAppCallRinging || activeCallId) {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowAlert: true,
        shouldPlaySound: false, // InCallManager / native channel owns ringtone
        shouldSetBadge: false,
      };
    }

    if (type === 'missed_call') {
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    }

    const isMsg =
      type === 'message' ||
      type === 'mention' ||
      kind === 'message' ||
      kind === 'group' ||
      kind === 'mention';
    const suppressChat = isMsg && convId != null && convId === openConversationId;
    // During an active call, still show the tray entry but no sound (WhatsApp-class).
    const silentDuringCall = isMsg && !!activeCallId;
    return {
      shouldShowAlert: !suppressChat,
      shouldPlaySound: !suppressChat && !silentDuringCall,
      shouldSetBadge: true,
    };
  },
});

let initialized = false;
let pushActive = false;
let lastToken: string | null = null;
let openConversationId: string | null = null;
/** When true, in-app IncomingCallView owns the ring UI — suppress tray duplicates. */
let inAppCallRinging = false;
/** When set, an active WebRTC call is live — silence message notif sound. */
let activeCallId: string | null = null;

/** CallProvider: full-screen ring UI is visible (foreground). */
export function setInAppCallRinging(ringing: boolean): void {
  inAppCallRinging = ringing;
}

/** CallProvider / ActiveCallView: ongoing call id or null. */
export function setActiveCallId(callId: string | null): void {
  activeCallId = callId;
}

export function getActiveCallId(): string | null {
  return activeCallId;
}

export type NotificationResponseHandler = (response: {
  type: string;
  action?: string;
  conversationId?: string;
  callId?: string;
  statusId?: string;
  communityId?: string;
  replyText?: string;
}) => Promise<void>;

let notificationResponseHandler: NotificationResponseHandler | null = null;

export function setNotificationResponseHandler(handler: NotificationResponseHandler | null): void {
  notificationResponseHandler = handler;
}

export function isPushActive(): boolean {
  return pushActive;
}

export function setOpenConversation(id: string | null): void {
  openConversationId = id;
}
export function getOpenConversation(): string | null {
  return openConversationId;
}

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
          communityId: typeof data?.communityId === 'string' ? data.communityId : undefined,
          replyText: typeof response.userText === 'string' ? response.userText : undefined,
        }).catch(console.error);
      }
    });
    return () => {
      try {
        sub.remove();
      } catch { /* ignore */ }
    };
  } catch {
    return () => {};
  }
}

/** Create channels + action categories. Idempotent. */
export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // Message: Reply / Mark read / Mute / Archive (WhatsApp parity actions)
    await Notifications.setNotificationCategoryAsync(CATEGORY.message, [
      {
        identifier: 'reply',
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mark_read',
        buttonTitle: 'Mark as read',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mute',
        buttonTitle: 'Mute',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'archive',
        buttonTitle: 'Archive',
        options: { opensAppToForeground: false },
      },
    ]);
    // Fallback (Expo Go / iOS). Android release uses native CallStyle:
    // Decline · Mute · Answer — Decline/Mute must NOT open the app.
    await Notifications.setNotificationCategoryAsync(CATEGORY.call, [
      {
        identifier: 'decline',
        buttonTitle: 'Decline',
        options: { isDestructive: true, opensAppToForeground: false },
      },
      {
        identifier: 'mute',
        buttonTitle: 'Mute',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'accept',
        buttonTitle: 'Answer',
        options: { opensAppToForeground: true },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.status, [
      {
        identifier: 'reply',
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Your reply' },
      },
      { identifier: 'open', buttonTitle: 'View status' },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.mention, [
      {
        identifier: 'reply',
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Your message' },
      },
      {
        identifier: 'mark_read',
        buttonTitle: 'Mark as read',
        options: { opensAppToForeground: false },
      },
      { identifier: 'open', buttonTitle: 'Open group' },
    ]);
  } catch { /* categories best-effort */ }

  if (Platform.OS !== 'android') return;

  const done = await AsyncStorage.getItem(CHANNELS_KEY).catch(() => null);
  if (done === CHANNELS_VERSION) return;

  const I = Notifications.AndroidImportance;
  try {
    // Channel groups (system settings organization)
    await Notifications.setNotificationChannelGroupAsync('chats', { name: 'Chats' });
    await Notifications.setNotificationChannelGroupAsync('calls_grp', { name: 'Calls' });
    await Notifications.setNotificationChannelGroupAsync('other', { name: 'Other' });

    await Notifications.setNotificationChannelAsync(CHANNELS.messages, {
      name: 'Messages',
      importance: I.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
      groupId: 'chats',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.groups, {
      name: 'Group Messages',
      importance: I.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      showBadge: true,
      groupId: 'chats',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.calls, {
      name: 'Incoming calls',
      importance: I.MAX,
      sound: 'default',
      vibrationPattern: [0, 1000, 1000, 1000, 1000, 1000],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
      groupId: 'calls_grp',
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: {
          enforceAudibility: true,
          requestHardwareAudioVideoSynchronization: false,
        },
      },
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.missedCalls, {
      name: 'Missed Calls',
      importance: I.HIGH,
      sound: 'default',
      vibrationPattern: [0, 300],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      showBadge: true,
      groupId: 'calls_grp',
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: {
          enforceAudibility: false,
          requestHardwareAudioVideoSynchronization: false,
        },
      },
    });
    // Ongoing call: low importance, no sound — keeps OS aware of active call.
    await Notifications.setNotificationChannelAsync(CHANNELS.ongoingCall, {
      name: 'Ongoing calls',
      importance: I.LOW,
      sound: undefined,
      enableVibrate: false,
      showBadge: false,
      groupId: 'calls_grp',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.status, {
      name: 'Status Replies',
      importance: I.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      showBadge: true,
      groupId: 'other',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.mentions, {
      name: 'Mentions',
      importance: I.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      showBadge: true,
      groupId: 'chats',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.communities, {
      name: 'Communities',
      importance: I.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      showBadge: true,
      groupId: 'other',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.system, {
      name: 'Admin / System',
      importance: I.HIGH,
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      lightColor: LED,
      groupId: 'other',
    });
    await AsyncStorage.setItem(CHANNELS_KEY, CHANNELS_VERSION);
  } catch { /* channel creation best-effort */ }
}

/**
 * Ask for POST_NOTIFICATIONS (Android 13+) and register the raw FCM/APNs device
 * token. Killed-app delivery depends on this token living in device_push_tokens.
 * Uses getDevicePushTokenAsync (not Expo push service) so FCM works offline of Expo.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.status === 'granted';
    if (!granted) {
      // Legitimate system prompt — required for Android 13+ and iOS.
      const req = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: false,
        },
      });
      granted = req.status === 'granted';
    }
    if (!granted) {
      pushActive = false;
      return false;
    }
    const token = await Notifications.getDevicePushTokenAsync();
    if (token?.data) {
      lastToken = String(token.data);
      const platform =
        token.type === 'ios' || Platform.OS === 'ios'
          ? 'ios'
          : token.type === 'web' || Platform.OS === 'web'
            ? 'web'
            : 'android';
      await registerPushToken(supabase, lastToken, platform);
      pushActive = true;
      return true;
    }
    pushActive = false;
    return false;
  } catch {
    /* FCM / google-services not configured yet */
    pushActive = false;
    return false;
  }
}

/** Whether the OS has granted notification permission (does not register token). */
export async function getNotificationPermissionGranted(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Open system screens so the user can allow notifications / unrestricted battery.
 * Policy-safe: user-initiated only (no auto REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
 */
export async function openNotificationSystemSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          { key: 'android.provider.extra.APP_PACKAGE', value: 'dev.lakshmeshwar.futurehat' },
        ]);
        return;
      } catch { /* fall through */ }
    }
    await Linking.openSettings();
  } catch { /* ignore */ }
}

/** Open battery optimization / app details so OEM can allow killed-state FCM. */
export async function openBatteryOptimizationSettings(): Promise<void> {
  try {
    if (await openBatteryAssistantSettings()) return;
  } catch { /* fall through */ }
  try {
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL('package:dev.lakshmeshwar.futurehat');
        return;
      } catch { /* fall through */ }
    }
    await Linking.openSettings();
  } catch { /* ignore */ }
}

export function startPushTokenRefresh(): () => void {
  try {
    const sub = Notifications.addPushTokenListener((t) => {
      const next = String((t as any)?.data ?? '');
      if (!next || next === lastToken) return;
      lastToken = next;
      pushActive = true;
      registerPushToken(supabase, next, ((t as any)?.type as any) ?? 'android').catch(() => {});
    });
    return () => {
      try {
        sub.remove();
      } catch { /* ignore */ }
    };
  } catch {
    return () => {};
  }
}

export async function unregisterForPush(): Promise<void> {
  try {
    const token = lastToken ?? String((await Notifications.getDevicePushTokenAsync())?.data ?? '');
    if (token) await removePushToken(supabase, token);
  } catch { /* ignore */ } finally {
    lastToken = null;
    pushActive = false;
  }
}

// ── Stacking / grouping (one notification per chat) ─────────────────────────

type StackEntry = { count: number; lastBody: string; title: string };

async function loadStacks(): Promise<Record<string, StackEntry>> {
  try {
    const raw = await AsyncStorage.getItem(UNREAD_STACK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StackEntry>) : {};
  } catch {
    return {};
  }
}

async function saveStacks(s: Record<string, StackEntry>): Promise<void> {
  try {
    await AsyncStorage.setItem(UNREAD_STACK_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

async function bumpStack(
  conversationId: string,
  title: string,
  body: string,
): Promise<{ count: number; displayBody: string }> {
  const stacks = await loadStacks();
  const prev = stacks[conversationId];
  const count = (prev?.count ?? 0) + 1;
  stacks[conversationId] = { count, lastBody: body, title };
  await saveStacks(stacks);
  // WhatsApp: first message shows preview; stacked shows "N new messages".
  const displayBody =
    count <= 1 ? body : count === 2 ? `${body}\n+1 more message` : `${body}\n+${count - 1} more messages`;
  return { count, displayBody };
}

export async function resetConversationStack(conversationId: string): Promise<void> {
  const stacks = await loadStacks();
  if (stacks[conversationId]) {
    delete stacks[conversationId];
    await saveStacks(stacks);
  }
}

/** Human preview for any message type (photos, voice, polls, stickers, …). */
export function messagePreviewText(m: {
  type?: string | null;
  content?: string | null;
  media_url?: string | null;
}): string {
  const type = m.type ?? 'text';
  const content = (m.content ?? '').trim();

  if (type === 'text') {
    if (!content) return 'Message';
    if (content.startsWith('📊')) return content.slice(0, 180);
    if (/^(📍|location:)/i.test(content)) return '📍 Location';
    if (/^(👤|contact:)/i.test(content)) return '👤 Contact';
    return content.slice(0, 180);
  }
  if (type === 'image') {
    if (/\.gif(\?|#|$)/i.test(m.media_url ?? '') || /gif/i.test(content)) return '🎞️ GIF';
    return '📷 Photo';
  }
  if (type === 'video') return '🎥 Video';
  if (type === 'audio' || type === 'voice') return '🎤 Voice message';
  if (type === 'file') return content ? `📄 ${content.slice(0, 100)}` : '📄 Document';
  if (type === 'sticker') return 'Sticker';
  if (type === 'system') return content || 'Update';
  return 'New message';
}

export interface MessageNotifOpts {
  conversationId: string;
  title: string;
  body: string;
  isGroup?: boolean;
  isMention?: boolean;
  messageId?: string;
  senderAvatar?: string;
  /** When true, do not bump stack (already counted). */
  replaceOnly?: boolean;
}

/** Present a local message notification. Grouped per chat; stacked body. */
export async function presentMessageNotification(o: MessageNotifOpts): Promise<void> {
  try {
    // Never notify for the open chat (double-guard with handler).
    if (openConversationId === o.conversationId) return;

    const { count, displayBody } = o.replaceOnly
      ? { count: 1, displayBody: o.body }
      : await bumpStack(o.conversationId, o.title, o.body);

    // Title: "Name" or "Name (5)" style when stacked (Android still shows one card).
    const title = count > 1 ? `${o.title}` : o.title;
    const body =
      count > 1
        ? // Lead with count so collapsed tray reads like WhatsApp.
          `${count} new messages\n${o.body}`
        : displayBody;

    // Active call: still stack tray messages, but no ringtone (WhatsApp-class).
    const silent = !!activeCallId;

    await Notifications.scheduleNotificationAsync({
      // Same id as FCM android.notification.tag → collapses to one tray entry.
      identifier: `chat:${o.conversationId}`,
      content: {
        title,
        body,
        subtitle: count > 1 ? `${count} new messages` : undefined,
        categoryIdentifier: o.isMention ? CATEGORY.mention : CATEGORY.message,
        data: {
          type: o.isMention ? 'mention' : 'message',
          conversationId: o.conversationId,
          messageId: o.messageId ?? '',
          kind: o.isMention ? 'mention' : o.isGroup ? 'group' : 'message',
          count: String(count),
          avatarUrl: o.senderAvatar ?? '',
        },
        sound: silent ? undefined : 'default',
        badge: 1,
        color: ACCENT,
        ...(Platform.OS === 'android'
          ? {
              channelId: o.isMention
                ? CHANNELS.mentions
                : o.isGroup
                  ? CHANNELS.groups
                  : CHANNELS.messages,
              priority: Notifications.AndroidNotificationPriority.HIGH,
              sticky: false,
              vibrate: silent ? [] : [0, 250, 250, 250],
            }
          : {}),
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
  avatarUrl?: string;
}

/**
 * High-priority incoming-call notification with Accept/Decline.
 * Android release builds: native fullScreenIntent + CallStyle (IncomingCall module).
 * Fallback: expo-notifications MAX channel (Expo Go / pre-prebuild).
 */
export async function presentCallNotification(o: CallNotifOpts): Promise<void> {
  try {
    // Never double-post when the in-app full-screen ring is already up.
    if (inAppCallRinging) return;

    await Notifications.dismissNotificationAsync(`call:${o.callId}`).catch(() => {});
    const body = o.video ? 'Incoming video call' : 'Incoming voice call';
    const nativeOk = await nativeShowIncomingCall({
      callId: o.callId,
      conversationId: o.conversationId,
      title: o.title,
      body,
      video: o.video,
    });
    if (nativeOk) {
      // Collapse any Expo-fallback duplicate for the same call id.
      await Notifications.dismissNotificationAsync(`call:${o.callId}`).catch(() => {});
      void recordDelivery({ kind: 'call', callId: o.callId, sentAt: Date.now() });
      return;
    }
    await Notifications.scheduleNotificationAsync({
      identifier: `call:${o.callId}`,
      content: {
        title: o.title,
        body,
        categoryIdentifier: CATEGORY.call,
        data: {
          type: 'call',
          callId: o.callId,
          conversationId: o.conversationId,
          video: String(!!o.video),
          kind: 'call',
          avatarUrl: o.avatarUrl ?? '',
        },
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: false,
        color: ACCENT,
        sound: Platform.OS === 'ios' ? 'default' : undefined,
        ...(Platform.OS === 'android'
          ? {
              channelId: CHANNELS.calls,
              vibrate: [0, 1000, 1000, 1000],
            }
          : {
              interruptionLevel: 'timeSensitive' as const,
            }),
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

/** Update app icon badge (iOS + supporting Android launchers). */
export async function setBadgeCount(n: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(n)));
  } catch { /* ignore */ }
}

/** Pull authoritative unread total from the server (preferred over local estimates). */
export async function syncBadgeFromServer(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('my_total_unread');
    if (error) throw error;
    const n = typeof data === 'number' ? data : Number(data) || 0;
    await setBadgeCount(n);
    return n;
  } catch {
    return -1;
  }
}

export interface StatusReplyNotifOpts {
  statusId: string;
  statusOwnerId: string;
  title: string;
  body: string;
}

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
        color: ACCENT,
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
  messageId?: string;
}

export async function presentMentionNotification(o: MentionNotifOpts): Promise<void> {
  return presentMessageNotification({
    conversationId: o.conversationId,
    title: o.groupName,
    body: `${o.mentioner}: ${o.body}`,
    isGroup: true,
    isMention: true,
    messageId: o.messageId,
  });
}

export interface MissedCallNotifOpts {
  callId: string;
  conversationId: string;
  title: string;
  isVideo?: boolean;
}

export async function presentMissedCallNotification(o: MissedCallNotifOpts): Promise<void> {
  try {
    // Drop any lingering ring notification first (no ghost calls).
    await clearCallNotification(o.callId);
    await Notifications.scheduleNotificationAsync({
      identifier: `missed:${o.callId}`,
      content: {
        title: `Missed ${o.isVideo ? 'video' : 'voice'} call`,
        body: o.title,
        // Tap opens the chat (not the call UI) — conversationId required.
        data: {
          type: 'missed_call',
          callId: o.callId,
          conversationId: o.conversationId,
          kind: 'missed_call',
        },
        ...(Platform.OS === 'android' ? { channelId: CHANNELS.missedCalls } : {}),
        sound: 'default',
        color: ACCENT,
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface CommunityNotifOpts {
  communityId: string;
  communityName: string;
  title: string;
  body: string;
}

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
        color: ACCENT,
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

/** Clear a chat's notification when opened / read / muted / archived. */
export async function clearConversationNotification(conversationId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`chat:${conversationId}`);
  } catch { /* ignore */ }
  await resetConversationStack(conversationId);
}

export async function clearCallNotification(callId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`call:${callId}`);
  } catch { /* ignore */ }
  await nativeCancelIncomingCall(callId);
  await clearOngoingCallNotification(callId);
}

/** Sticky "call in progress" tray entry so users can return from other apps. */
export async function presentOngoingCallNotification(o: {
  callId: string;
  conversationId: string;
  title: string;
  video?: boolean;
  connected?: boolean;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `ongoing:${o.callId}`,
      content: {
        title: o.connected ? 'Call in progress' : 'Connecting…',
        body: o.title,
        data: {
          type: 'ongoing_call',
          kind: 'call',
          callId: o.callId,
          conversationId: o.conversationId,
          video: String(!!o.video),
        },
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
        sound: undefined,
        ...(Platform.OS === 'android'
          ? { channelId: CHANNELS.ongoingCall }
          : { interruptionLevel: 'active' as const }),
      },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export async function clearOngoingCallNotification(callId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`ongoing:${callId}`);
  } catch { /* ignore */ }
}

export async function clearStatusReplyNotification(statusId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`status:${statusId}`);
  } catch { /* ignore */ }
}

export async function clearMentionNotification(conversationId: string): Promise<void> {
  return clearConversationNotification(conversationId);
}

export async function clearMissedCallNotification(callId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`missed:${callId}`);
  } catch { /* ignore */ }
}

export async function clearCommunityNotification(communityId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`community:${communityId}`);
  } catch { /* ignore */ }
}

/** Dismiss all presented notifications (e.g. sign-out). */
export async function clearAllNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch { /* ignore */ }
  try {
    await AsyncStorage.removeItem(UNREAD_STACK_KEY);
  } catch { /* ignore */ }
  await setBadgeCount(0);
}
