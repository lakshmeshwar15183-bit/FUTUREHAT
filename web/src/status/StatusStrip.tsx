// Lumixo web — horizontal Status strip (WhatsApp home-screen parity).
// Mounted under the Lumixo sidebar header: "My status" tile + a horizontal row
// of recent updates with seen/unseen rings. Opens the full-screen viewer or the
// composer. Refreshes on mount and stays live via realtime status changes.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import {
  getActiveStatuses,
  getMyViewedStatusIds,
  subscribeStatusChanges,
} from '@shared/api';
import { getStatusAudiencePref } from '@shared/privacyApi';
import type { StatusAudience } from '@shared/types';
import { buildStatusGroups, pruneExpiredGroups, type StatusGroup } from './statusData';
import { StatusViewer } from './StatusViewer';
import { StatusComposer, type ComposerMode } from './StatusComposer';
import { afterFirstPaint } from '../lib/startupCache';
import './status.css';

export function StatusStrip() {
  const { profile } = useAuth();
  const myId = profile?.id;

  const [mine, setMine] = useState<StatusGroup | null>(null);
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [player, setPlayer] = useState<StatusGroup | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  const [audience, setAudience] = useState<StatusAudience>('everyone');
  const [members, setMembers] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!myId) return;
    const [all, viewed] = await Promise.all([
      getActiveStatuses(supabase),
      getMyViewedStatusIds(supabase),
    ]);
    const { mine: m, groups: g } = buildStatusGroups(all, myId, viewed);
    setMine(m);
    setGroups(g);
  }, [myId]);

  // Status is non-critical for first paint — defer network + realtime.
  useEffect(() => {
    let cancelled = false;
    let ch: { unsubscribe: () => void } | null = null;
    afterFirstPaint(() => {
      if (cancelled) return;
      void load();
      getStatusAudiencePref(supabase)
        .then((pref) => {
          if (!cancelled) {
            setAudience(pref.audience);
            setMembers(pref.memberIds);
          }
        })
        .catch(() => {});
      ch = subscribeStatusChanges(supabase, () => { void load(); });
    });
    return () => {
      cancelled = true;
      ch?.unsubscribe();
    };
  }, [load]);

  // Client-side 36h expiry (CP5): prune expired statuses at `expires_at` and
  // schedule the next tick — no polling, no refetch. A state change re-runs this
  // effect and reschedules for the next-soonest expiry.
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const now = Date.now();
    const res = pruneExpiredGroups(mine, groups, now);
    if (res.changed) {
      setMine(res.mine);
      setGroups(res.groups);
      return; // the state change re-runs this effect and reschedules
    }
    if (res.nextExpiry == null) return;
    const delay = Math.max(0, res.nextExpiry - now) + 500;
    expiryTimer.current = setTimeout(() => {
      const t = Date.now();
      setGroups((gs) => pruneExpiredGroups(null, gs, t).groups);
      setMine((m) => pruneExpiredGroups(m, [], t).mine);
    }, delay);
    return () => { if (expiryTimer.current) clearTimeout(expiryTimer.current); };
  }, [mine, groups]);

  // Close the add-menu on outside click.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  function openMine() {
    if (mine) setPlayer(mine);
    else setMenuOpen(true);
  }

  function choose(mode: ComposerMode) {
    setMenuOpen(false);
    setComposeMode(mode);
  }

  function onExhausted() {
    const idx = groups.findIndex((g) => g.userId === player?.userId);
    const next = idx >= 0 ? groups.slice(idx + 1)[0] : undefined;
    setPlayer(next ?? null);
  }

  if (!myId) return null;

  return (
    <div className="status-strip">
      <div className="status-strip-row">
        {/* My status tile — WhatsApp behavior: avatar opens viewer (or picker
            if no status yet), the "+" badge is its own button that ALWAYS opens
            the picker so users can add a second/third status without long-press. */}
        <div className="status-tile-wrap">
          <button className="status-tile" onClick={openMine}>
            <div className={`strip-ring ${mine ? 'ring-mine' : 'ring-empty'}`}>
              {mine?.avatar || profile?.avatar_url ? (
                <img src={mine?.avatar || profile?.avatar_url || ''} alt="" className="strip-avatar" />
              ) : (
                <div className="strip-avatar fallback">{(profile?.display_name || 'M')[0]}</div>
              )}
            </div>
            <span className="strip-label">My status</span>
          </button>
          <button
            type="button"
            className="strip-add-badge"
            onClick={() => setMenuOpen(true)}
            aria-label="Add status"
            title="Add status"
          >＋</button>

          {menuOpen && (
            <div className="strip-menu" ref={menuRef}>
              <button onClick={() => choose('text')}>✏️ Text</button>
              <button onClick={() => choose('media')}>📷 Photo / Video</button>
              <button onClick={() => choose('audio')}>🎙 Audio</button>
            </div>
          )}
        </div>

        {/* Recent updates */}
        {groups.map((g) => (
          <button key={g.userId} className="status-tile" onClick={() => setPlayer(g)}>
            <div className={`strip-ring ${g.allSeen ? 'ring-seen' : 'ring-unseen'}`}>
              {g.avatar ? (
                <img src={g.avatar} alt="" className="strip-avatar" />
              ) : (
                <div className="strip-avatar fallback">{g.name[0]}</div>
              )}
            </div>
            <span className="strip-label">{g.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Composer */}
      {composeMode && (
        <StatusComposer
          mode={composeMode}
          myId={myId}
          initialAudience={audience}
          initialMembers={members}
          onClose={() => setComposeMode(null)}
          onPosted={load}
        />
      )}

      {/* Viewer */}
      {player && (
        <div className="story-backdrop" onClick={() => setPlayer(null)}>
          <StatusViewer
            group={player}
            isMine={player.userId === myId}
            onClose={() => setPlayer(null)}
            onExhausted={onExhausted}
            onChanged={load}
          />
        </div>
      )}
    </div>
  );
}
