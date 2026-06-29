// FUTUREHAT — global online/offline presence via Supabase Realtime Presence.
// Exposes the set of currently-online user ids and keeps last_seen fresh.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { joinPresence, touchLastSeen } from '@shared/api';

const PresenceContext = createContext<{ onlineIds: Set<string> }>({ onlineIds: new Set() });

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set());
      return;
    }
    const channel = joinPresence(supabase, user.id, setOnlineIds);
    touchLastSeen(supabase);
    const heartbeat = setInterval(() => touchLastSeen(supabase), 60000);
    const onUnload = () => { touchLastSeen(supabase); };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', onUnload);
      touchLastSeen(supabase);
      channel.unsubscribe();
    };
  }, [user]);

  return <PresenceContext.Provider value={{ onlineIds }}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
