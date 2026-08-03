// Lumixo — app-wide status index + modal hosts for Status / Profile photo.
// Single source of truth so chat list, headers, profiles, calls, etc. share
// the same rings and open the same polished viewers without N+1 fetches.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Modal, type AppStateStatus } from 'react-native';

import { supabase } from '../../lib/supabase';
import {
  getActiveStatuses,
  getMyViewedStatusIds,
  getCurrentUser,
  getProfile,
  subscribeStatusChanges,
} from '../../lib/shared';
import { getCache, setCache } from '../../lib/localCache';
import {
  buildStatusGroups,
  pruneExpiredGroups,
  type StatusGroup,
} from './statusData';
import StatusViewer from './StatusViewer';
import ProfilePhotoViewer from '../ProfilePhotoViewer';

const CACHE_KEY = 'status:tray';

type PhotoTarget = { uri: string | null; name?: string | null };

type StatusPresenceValue = {
  myId: string | null;
  mine: StatusGroup | null;
  groups: StatusGroup[];
  loading: boolean;
  refresh: () => Promise<void>;
  getGroup: (userId?: string | null) => StatusGroup | null;
  hasActive: (userId?: string | null) => boolean;
  isUnseen: (userId?: string | null) => boolean;
  segmentCount: (userId?: string | null) => number;
  openStatus: (userId: string) => void;
  openStatusGroup: (group: StatusGroup) => void;
  openPhoto: (opts: PhotoTarget) => void;
  /** Primary avatar tap: status if active, else profile photo. */
  openAvatar: (opts: {
    userId?: string | null;
    uri?: string | null;
    name?: string | null;
  }) => void;
};

const StatusPresenceContext = createContext<StatusPresenceValue | null>(null);

export function StatusPresenceProvider({ children }: { children: React.ReactNode }) {
  const [myId, setMyId] = useState<string | null>(null);
  const [mine, setMine] = useState<StatusGroup | null>(null);
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<StatusGroup | null>(null);
  const [photo, setPhoto] = useState<PhotoTarget | null>(null);
  const byUserRef = useRef<Map<string, StatusGroup>>(new Map());

  const rebuildIndex = useCallback((m: StatusGroup | null, gs: StatusGroup[]) => {
    const map = new Map<string, StatusGroup>();
    if (m) map.set(m.userId, m);
    for (const g of gs) map.set(g.userId, g);
    byUserRef.current = map;
  }, []);

  const refresh = useCallback(async () => {
    // Instant paint from cache
    getCache<{ mine: StatusGroup | null; groups: StatusGroup[] }>(CACHE_KEY, {
      mine: null,
      groups: [],
    }).then((cached) => {
      if (cached.groups.length || cached.mine) {
        setMine(cached.mine);
        setGroups(cached.groups);
        rebuildIndex(cached.mine, cached.groups);
      }
    });

    const user = await getCurrentUser(supabase);
    const uid = user?.id ?? '';
    setMyId(user?.id ?? null);

    let all;
    let viewed: Set<string>;
    try {
      [all, viewed] = await Promise.all([
        getActiveStatuses(supabase),
        getMyViewedStatusIds(supabase),
      ]);
    } catch {
      setLoading(false);
      return;
    }

    const { mine: mineGroup, groups: built } = await buildStatusGroups(
      all,
      uid,
      viewed,
      (id) => getProfile(supabase, id),
    );
    setMine(mineGroup);
    setGroups(built);
    rebuildIndex(mineGroup, built);
    setCache(CACHE_KEY, { mine: mineGroup, groups: built });
    setLoading(false);
  }, [rebuildIndex]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime status inserts/deletes
  useEffect(() => {
    const ch = subscribeStatusChanges(supabase, () => {
      void refresh();
    });
    return () => {
      ch.unsubscribe();
    };
  }, [refresh]);

  // Foreground refresh
  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') void refresh();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  // Client-side expiry prune
  useEffect(() => {
    const now = Date.now();
    const res = pruneExpiredGroups(mine, groups, now);
    if (res.changed) {
      setMine(res.mine);
      setGroups(res.groups);
      rebuildIndex(res.mine, res.groups);
      setCache(CACHE_KEY, { mine: res.mine, groups: res.groups });
    }
    if (res.nextExpiry == null) return;
    const delay = Math.max(0, res.nextExpiry - now) + 500;
    const t = setTimeout(() => {
      const tick = Date.now();
      setGroups((gs) => {
        const r = pruneExpiredGroups(null, gs, tick);
        return r.groups;
      });
      setMine((m) => pruneExpiredGroups(m, [], Date.now()).mine);
    }, delay);
    return () => clearTimeout(t);
  }, [mine, groups, rebuildIndex]);

  // Keep byUserRef in sync when mine/groups change without going through rebuildIndex paths
  useEffect(() => {
    rebuildIndex(mine, groups);
  }, [mine, groups, rebuildIndex]);

  const getGroup = useCallback((userId?: string | null) => {
    if (!userId) return null;
    return byUserRef.current.get(userId) ?? null;
  }, []);

  const hasActive = useCallback(
    (userId?: string | null) => !!getGroup(userId)?.statuses.length,
    [getGroup],
  );

  const isUnseen = useCallback(
    (userId?: string | null) => {
      const g = getGroup(userId);
      if (!g || !g.statuses.length) return false;
      if (userId === myId) return false;
      return !g.allSeen;
    },
    [getGroup, myId],
  );

  const segmentCount = useCallback(
    (userId?: string | null) => getGroup(userId)?.statuses.length ?? 0,
    [getGroup],
  );

  const openStatusGroup = useCallback((group: StatusGroup) => {
    if (!group.statuses.length) return;
    setViewing(group);
  }, []);

  const openStatus = useCallback(
    (userId: string) => {
      const g = getGroup(userId);
      if (g) openStatusGroup(g);
    },
    [getGroup, openStatusGroup],
  );

  const openPhoto = useCallback((opts: PhotoTarget) => {
    setPhoto({ uri: opts.uri ?? null, name: opts.name ?? null });
  }, []);

  const openAvatar = useCallback(
    (opts: { userId?: string | null; uri?: string | null; name?: string | null }) => {
      if (opts.userId && hasActive(opts.userId)) {
        openStatus(opts.userId);
        return;
      }
      openPhoto({ uri: opts.uri ?? null, name: opts.name });
    },
    [hasActive, openStatus, openPhoto],
  );

  const value = useMemo<StatusPresenceValue>(
    () => ({
      myId,
      mine,
      groups,
      loading,
      refresh,
      getGroup,
      hasActive,
      isUnseen,
      segmentCount,
      openStatus,
      openStatusGroup,
      openPhoto,
      openAvatar,
    }),
    [
      myId,
      mine,
      groups,
      loading,
      refresh,
      getGroup,
      hasActive,
      isUnseen,
      segmentCount,
      openStatus,
      openStatusGroup,
      openPhoto,
      openAvatar,
    ],
  );

  return (
    <StatusPresenceContext.Provider value={value}>
      {children}
      <Modal
        visible={!!viewing}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        statusBarTranslucent
      >
        {viewing && (
          <StatusViewer
            group={viewing}
            isMine={viewing.userId === myId}
            onClose={() => {
              setViewing(null);
              void refresh();
            }}
            onChanged={() => {
              void refresh();
            }}
          />
        )}
      </Modal>
      <ProfilePhotoViewer
        visible={!!photo}
        uri={photo?.uri}
        name={photo?.name}
        onClose={() => setPhoto(null)}
      />
    </StatusPresenceContext.Provider>
  );
}

export function useStatusPresence(): StatusPresenceValue {
  const ctx = useContext(StatusPresenceContext);
  if (!ctx) {
    // Safe no-op fallback when used outside provider (stories, tests).
    return {
      myId: null,
      mine: null,
      groups: [],
      loading: false,
      refresh: async () => {},
      getGroup: () => null,
      hasActive: () => false,
      isUnseen: () => false,
      segmentCount: () => 0,
      openStatus: () => {},
      openStatusGroup: () => {},
      openPhoto: () => {},
      openAvatar: (opts) => {
        // without provider we still allow photo via no-op
        void opts;
      },
    };
  }
  return ctx;
}

