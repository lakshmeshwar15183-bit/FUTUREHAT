/**
 * Notification delivery latency probe.
 * Server stamps FCM data.sentAt (ms). Client records when the notification is
 * received / opened for diagnostics (Settings → Diagnostics & report).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fh:notifLatency:v1';
const MAX = 40;

export type LatencySample = {
  at: number;
  kind: 'message' | 'call' | 'open' | 'other';
  /** Server → device receive (ms), if sentAt present. */
  deliveryMs?: number;
  /** Tap → handler (ms), optional. */
  openMs?: number;
  messageId?: string;
  callId?: string;
};

async function load(): Promise<LatencySample[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LatencySample[]) : [];
  } catch {
    return [];
  }
}

async function save(rows: LatencySample[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch { /* ignore */ }
}

export async function recordDelivery(opts: {
  kind: LatencySample['kind'];
  sentAt?: string | number | null;
  messageId?: string;
  callId?: string;
}): Promise<number | undefined> {
  const now = Date.now();
  let deliveryMs: number | undefined;
  if (opts.sentAt != null && opts.sentAt !== '') {
    const sent = typeof opts.sentAt === 'number' ? opts.sentAt : Number(opts.sentAt);
    if (Number.isFinite(sent) && sent > 0 && now >= sent) {
      deliveryMs = now - sent;
    }
  }
  const rows = await load();
  rows.push({
    at: now,
    kind: opts.kind,
    deliveryMs,
    messageId: opts.messageId,
    callId: opts.callId,
  });
  await save(rows);
  return deliveryMs;
}

export async function getLatencySummary(): Promise<{
  count: number;
  avgDeliveryMs: number | null;
  p95DeliveryMs: number | null;
  samples: LatencySample[];
}> {
  const rows = await load();
  const ms = rows.map((r) => r.deliveryMs).filter((n): n is number => typeof n === 'number' && n >= 0);
  if (!ms.length) {
    return { count: 0, avgDeliveryMs: null, p95DeliveryMs: null, samples: rows };
  }
  const sorted = [...ms].sort((a, b) => a - b);
  const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { count: ms.length, avgDeliveryMs: avg, p95DeliveryMs: p95, samples: rows };
}

export async function clearLatencySamples(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
