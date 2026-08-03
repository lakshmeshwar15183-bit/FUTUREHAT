// Lumixo mobile — field measurement log for device-proof harness.
// Operators export JSON after FCM/call sessions → validation/results/device-proof-LATEST.json
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fh:deviceProof:v1';

export type ProofSample = {
  kind: 'fcm_display' | 'call_ring' | 'call_connect' | 'hangup_cancel';
  ms: number;
  at: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export type DeviceProofLog = {
  samples: ProofSample[];
  pathCounts: { direct: number; relay: number; unknown: number };
};

async function read(): Promise<DeviceProofLog> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { samples: [], pathCounts: { direct: 0, relay: 0, unknown: 0 } };
    return JSON.parse(raw) as DeviceProofLog;
  } catch {
    return { samples: [], pathCounts: { direct: 0, relay: 0, unknown: 0 } };
  }
}

async function write(log: DeviceProofLog): Promise<void> {
  try {
    // Cap size so AsyncStorage stays healthy.
    const samples = log.samples.slice(-500);
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...log, samples }));
  } catch { /* ignore */ }
}

/** Record latency from push sentAt (server) to local display. */
export async function recordFcmDisplayLatency(sentAtMs: number | null | undefined): Promise<void> {
  if (!sentAtMs || !Number.isFinite(sentAtMs)) return;
  const ms = Date.now() - sentAtMs;
  if (ms < 0 || ms > 120_000) return;
  const log = await read();
  log.samples.push({ kind: 'fcm_display', ms, at: new Date().toISOString() });
  await write(log);
}

export async function recordCallRingLatency(startMs: number): Promise<void> {
  const ms = Date.now() - startMs;
  if (ms < 0 || ms > 120_000) return;
  const log = await read();
  log.samples.push({ kind: 'call_ring', ms, at: new Date().toISOString() });
  await write(log);
}

export async function recordCallConnectLatency(startMs: number): Promise<void> {
  const ms = Date.now() - startMs;
  if (ms < 0 || ms > 180_000) return;
  const log = await read();
  log.samples.push({ kind: 'call_connect', ms, at: new Date().toISOString() });
  await write(log);
}

export async function recordIcePath(path: 'direct' | 'relay' | 'unknown'): Promise<void> {
  const log = await read();
  log.pathCounts[path] = (log.pathCounts[path] ?? 0) + 1;
  await write(log);
}

export async function exportDeviceProofSummary(): Promise<{
  fcm_ms: number[];
  call_connect_ms: number[];
  path_counts: DeviceProofLog['pathCounts'];
  p95_fcm: number | null;
}> {
  const log = await read();
  const fcm = log.samples.filter((s) => s.kind === 'fcm_display').map((s) => s.ms);
  const connect = log.samples.filter((s) => s.kind === 'call_connect').map((s) => s.ms);
  const sorted = [...fcm].sort((a, b) => a - b);
  const p95 =
    sorted.length === 0
      ? null
      : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    fcm_ms: fcm,
    call_connect_ms: connect,
    path_counts: log.pathCounts,
    p95_fcm: p95,
  };
}

export async function clearDeviceProofLog(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
