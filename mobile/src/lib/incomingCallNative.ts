/**
 * Bridge to native IncomingCall module (full-screen / CallStyle on Android).
 * Falls back to expo-notifications presenters when the native module is absent
 * (Expo Go / pre-prebuild).
 */
import { NativeModules, Platform } from 'react-native';

type IncomingCallNative = {
  showIncomingCall(
    callId: string,
    conversationId: string,
    title: string,
    body: string,
    video: boolean,
  ): Promise<boolean>;
  cancelIncomingCall(callId: string): Promise<boolean>;
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
