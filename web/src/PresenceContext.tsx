// Lumixo — global online/offline presence via Supabase Realtime Presence.
// Exposes the set of currently-online user ids and keeps last_seen fresh.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { joinPresence, touchLastSeen } from '@shared/api';
import { afterFirstPaint } from './lib/startupCache';

const PresenceContext = createContext<{ onlineIds: Set<string> }>({ onlineIds: new Set() });

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set());
      return;
    }
    // Presence is non-critical — join after first paint so it never delays chats.
    let channel: { unsubscribe: () => void } | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const onUnload = () => { touchLastSeen(supabase); };

    afterFirstPaint(() => {
      if (cancelled) return;
      channel = joinPresence(supabase, user.id, setOnlineIds);
      touchLastSeen(supabase);
      heartbeat = setInterval(() => touchLastSeen(supabase), 60000);
      window.addEventListener('beforeunload', onUnload);
    });

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      window.removeEventListener('beforeunload', onUnload);
      touchLastSeen(supabase);
      channel?.unsubscribe();
    };
  }, [user]);

  return <PresenceContext.Provider value={{ onlineIds }}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
