/**
 * Bridge to native IncomingCall module (WhatsApp/Telegram-class).
 *
 * Decline / Mute are handled natively via BroadcastReceiver (never launch app).
 * Answer launches MainActivity. Pending decline is drained when JS wakes.
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export type PendingCallAction = {
  action: 'decline' | 'mute' | 'accept' | string;
  callId: string;
  conversationId?: string;
  video?: boolean;
};

type IncomingCallNative = {
  showIncomingCall(
    callId: string,
    conversationId: string,
    title: string,
    body: string,
    video: boolean,
  ): Promise<boolean>;
  cancelIncomingCall(callId: string): Promise<boolean>;
  cancelAllIncomingCalls?: () => Promise<boolean>;
  getPendingCallAction?: () => Promise<PendingCallAction | null>;
  clearPendingCallAction?: () => Promise<boolean>;
};

function getNative(): IncomingCallNative | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.IncomingCall as IncomingCallNative | undefined;
  return mod ?? null;
}

export function isNativeIncomingCallAvailable(): boolean {
  return !!getNative();
}

export async function nativeShowIncomingCall(opts: {
  callId: string;
  conversationId: string;
  title: string;
  body?: string;
  video?: boolean;
}): Promise<boolean> {
  const n = getNative();
  if (!n) return false;
  try {
    await n.showIncomingCall(
      opts.callId,
      opts.conversationId,
      opts.title,
      opts.body ?? (opts.video ? 'Incoming video call' : 'Incoming voice call'),
      !!opts.video,
    );
    return true;
  } catch {
    return false;
  }
}

export async function nativeCancelIncomingCall(callId: string): Promise<boolean> {
  const n = getNative();
  if (!n || !callId) return false;
  try {
    await n.cancelIncomingCall(callId);
    return true;
  } catch {
    return false;
  }
}

export async function nativeCancelAllIncomingCalls(): Promise<boolean> {
  const n = getNative();
  if (!n?.cancelAllIncomingCalls) return false;
  try {
    await n.cancelAllIncomingCalls();
    return true;
  } catch {
    return false;
  }
}

export async function nativeGetPendingCallAction(): Promise<PendingCallAction | null> {
  const n = getNative();
  if (!n?.getPendingCallAction) return null;
  try {
    const v = await n.getPendingCallAction();
    if (!v || !v.callId) return null;
    return v;
  } catch {
    return null;
  }
}

export async function nativeClearPendingCallAction(): Promise<void> {
  const n = getNative();
  if (!n?.clearPendingCallAction) return;
  try {
    await n.clearPendingCallAction();
  } catch {
    /* ignore */
  }
}

/** Live Decline/Mute events while JS is running (app backgrounded but process alive). */
export function subscribeNativeIncomingCallActions(
  handler: (payload: PendingCallAction) => void,
): () => void {
  if (Platform.OS !== 'android') return () => {};
  // Native emits via RCTDeviceEventEmitter — DeviceEventEmitter receives it.
  const sub = DeviceEventEmitter.addListener('IncomingCallAction', (raw: PendingCallAction) => {
    if (raw?.callId) handler(raw);
  });
  return () => {
    try {
      sub.remove();
    } catch {
      /* ignore */
    }
  };
}
