// Network class for media auto-download policy (isolates NetInfo from pure policy).
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import type { NetworkClass } from './mediaPolicy';

let lastNet: NetworkClass = 'unknown';
let roaming = false;

export function networkClassFromState(state: NetInfoState | null): NetworkClass {
  if (!state || state.isConnected === false) return 'none';
  const t = state.type;
  if (t === 'wifi' || t === 'ethernet' || t === 'wimax') return 'wifi';
  if (t === 'cellular') return 'cellular';
  if (t === 'none') return 'none';
  return 'unknown';
}

function applyState(s: NetInfoState) {
  lastNet = networkClassFromState(s);
  const d = s.details as { isConnectionExpensive?: boolean } | null;
  if (s.type === 'cellular' && d) roaming = !!d.isConnectionExpensive;
  else roaming = false;
}

NetInfo.fetch()
  .then(applyState)
  .catch(() => {});

NetInfo.addEventListener(applyState);

export function getNetworkClass(): NetworkClass {
  return lastNet;
}

export function isRoamingLike(): boolean {
  return roaming;
}
