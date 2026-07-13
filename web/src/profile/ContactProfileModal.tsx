// Lumixo — contact / user profile screen (Telegram-style): big avatar, name,
// @username, about, last seen, phone, and Message / Mute / Call / Video actions,
// plus an overflow with Share contact, Block and Report. Self-contained — block/
// report/mute are handled internally via supportApi; Message/Call/Video are
// delegated to the parent (which owns conversation + call state).
//
// Wiring (deferred to checkpoint recovery): open this from a chat header / avatar
// tap, passing the other participant's Profile and the three action callbacks.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import { safeHref, safeCssUrl, safeMediaSrc } from '../util/safeUrl';
import {
  blockUser, unblockUser, getBlockedIds, submitReport,
  muteConversation, unmuteConversation, getMutedIds,
} from '@shared/supportApi';
import { getSharedMedia, getDisappearing, setConversationDisappearing, isVideoMessage, resolveDisplayName, resolveUsernameHandle } from '@shared/api';
import { getLockedIds, lockConversation, unlockConversation } from '@shared/chatLockApi';
import { deviceAuth } from '../lib/deviceAuth';
import type { Profile, Message } from '@shared/types';
import { getNickname, setNickname } from '../lib/nicknames';
import { useAuth } from '../AuthContext';
import { MediaLightbox, type MediaItem } from '../media/MediaLightbox';
import '../media/MediaLightbox.css';
import { formatDistanceToNow } from 'date-fns';
import { modalBackdrop, modalPanel } from '../motion';
import './ContactProfileModal.css';
import '../moderator/ModeratorDashboard.css';

interface Props {
  profile: Profile;
  online?: boolean;
  isPremium?: boolean;
  conversationId?: string;            // present when a 1:1 chat already exists
  onClose: () => void;
  onMessage?: () => void;
  onCall?: () => void;
  onVideo?: () => void;
}

export function ContactProfileModal({ profile, online, isPremium, conversationId, onClose, onMessage, onCall, onVideo }: Props) {
  const { profile: me } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nickname, setNickState] = useState<string | null>(() =>
    me?.id ? getNickname(me.id, profile.id) : null,
  );
  const [media, setMedia] = useState<Message[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Disappearing messages (0022): per-chat timer, 0 = off else 3600..28800 (1–8h).
  const [disappearSecs, setDisappearSecs] = useState(0);
  // Chat Lock (0027): this chat locked behind the device's own auth (fingerprint /
  // face / PIN). No secret is stored by Lumixo.
  const [locked, setLocked] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);
  // Moderator badge (0023): profiles.role is world-readable; fetch it lightly.
  const [isModerator, setIsModerator] = useState(false);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2400); }

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.from('profiles').select('role').eq('id', profile.id).maybeSingle();
        setIsModerator(['moderator', 'admin', 'owner'].includes((data as { role?: string } | null)?.role ?? ''));
      } catch { /* ignore */ }
    })();
    getBlockedIds(supabase).then((ids) => setBlocked(ids.includes(profile.id))).catch(() => {});
    void deviceAuth.isAvailable().then(setLockAvailable).catch(() => setLockAvailable(false));
    if (conversationId) {
      getMutedIds(supabase).then((ids) => setMuted(ids.includes(conversationId))).catch(() => {});
      getSharedMedia(supabase, conversationId).then(setMedia).catch(() => {});
      getDisappearing(supabase, conversationId).then(setDisappearSecs).catch(() => {});
      getLockedIds(supabase).then((ids) => setLocked(ids.includes(conversationId))).catch(() => {});
    }
  }, [profile.id, conversationId]);

  // Toggle Chat Lock for this conversation. Both directions require the device auth
  // gesture (fingerprint / face / PIN) so only the device owner can change it.
  async function toggleLock() {
    if (!conversationId) return;
    if (!lockAvailable) {
      flash('Set up a screen lock (fingerprint, face, or PIN) on this device to use Chat Lock.');
      return;
    }
    const was = locked;
    const ok = await deviceAuth.authenticate(was ? 'Unlock chat' : 'Lock chat');
    if (!ok) return;
    setLocked(!was); // instant
    const { error } = was ? await unlockConversation(supabase, conversationId) : await lockConversation(supabase, conversationId);
    if (error) { setLocked(was); flash('Could not update Chat Lock'); }
    else flash(was ? 'Chat unlocked' : 'Chat locked');
  }

  async function chooseDisappearing(secs: number) {
    if (!conversationId) return;
    const prev = disappearSecs;
    setDisappearSecs(secs); // instant
    const { error } = await setConversationDisappearing(supabase, conversationId, secs);
    if (error) { setDisappearSecs(prev); flash('Could not update timer'); }
    else flash(secs > 0 ? 'Disappearing messages on' : 'Disappearing messages off');
  }

  // Photos + videos in shared media; docs exclude first-class and legacy videos.
  const photos = media.filter((m) => m.type === 'image' || isVideoMessage(m));
  const docs = media.filter((m) => m.type === 'file' && !isVideoMessage(m));
  const galleryItems: MediaItem[] = photos
    .filter((m) => !!m.media_url)
    .map((m) => ({
      id: m.id,
      url: m.media_url!,
      kind: m.type === 'image' ? ('image' as const) : ('video' as const),
      caption: m.content || undefined,
    }));
  const lightboxIndex = lightbox ? galleryItems.findIndex((g) => g.url === lightbox) : -1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightbox]);

  const displayName = resolveDisplayName(profile, {
    nickname,
    fallback: 'Contact',
  });
  const handle = resolveUsernameHandle(profile);

  function editNickname() {
    if (!me?.id) return;
    const next = prompt(
      nickname ? 'Edit nickname (empty to remove)' : 'Add nickname — only you will see this',
      nickname ?? '',
    );
    if (next === null) return; // cancelled
    const map = setNickname(me.id, profile.id, next);
    setNickState(map[profile.id] ?? null);
    flash(map[profile.id] ? 'Nickname saved' : 'Nickname removed');
  }

  async function toggleBlock() {
    setMenuOpen(false);
    const was = blocked;
    if (!was && !confirm(`Block ${displayName}?`)) return;
    setBlocked(!was);
    const { error } = was ? await unblockUser(supabase, profile.id) : await blockUser(supabase, profile.id);
    if (error) { setBlocked(was); flash('Could not update block.'); }
    else flash(was ? 'Unblocked' : 'Blocked');
  }

  async function toggleMute() {
    if (!conversationId) return;
    const was = muted;
    setMuted(!was);
    const { error } = was ? await unmuteConversation(supabase, conversationId) : await muteConversation(supabase, conversationId);
    if (error) { setMuted(was); flash('Could not update mute.'); }
  }

  async function report() {
    setMenuOpen(false);
    const reason = prompt('Report this user — what is the issue?');
    if (!reason?.trim()) return;
    const { error } = await submitReport(supabase, 'user', profile.id, reason.trim());
    flash(error ? 'Could not submit report.' : 'Report submitted.');
  }

  function shareContact() {
    setMenuOpen(false);
    const h = handle || profile.id.slice(0, 8);
    const text = `${displayName} (${h}) on Lumixo`;
    if (navigator.share) navigator.share({ title: 'Lumixo contact', text }).catch(() => {});
    else { navigator.clipboard?.writeText(text).then(() => flash('Contact copied')).catch(() => flash('Copy failed')); }
  }

  const presence = online ? 'online' : profile.last_seen
    ? `last seen ${formatDistanceToNow(new Date(profile.last_seen), { addSuffix: true })}`
    : 'offline';

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="contact-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <div className="contact-topbar">
          <button className="contact-back" onClick={onClose} aria-label="Close">←</button>
          <button className="contact-overflow" onClick={() => setMenuOpen((v) => !v)} aria-label="More options">⋮</button>
          {menuOpen && (
            <div className="contact-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={shareContact}>↗ Share contact</button>
              <button onClick={report}>🚩 Report</button>
              <button className="danger" onClick={toggleBlock}>{blocked ? 'Unblock' : '🚫 Block user'}</button>
            </div>
          )}
        </div>

        <div className="contact-hero">
          <div className="contact-avatar" style={safeCssUrl(profile.avatar_url) ? { backgroundImage: safeCssUrl(profile.avatar_url) } : undefined}>
            {!safeMediaSrc(profile.avatar_url) && (displayName[0]?.toUpperCase() || '?')}
            {online && <span className="contact-online-dot" />}
            {disappearSecs > 0 && <span className="contact-disappear-badge" title="Disappearing messages on">⏳</span>}
          </div>
          <div className="contact-name">
            {displayName}
            {isPremium && <span className="contact-badge" title="Lumixo+">✦</span>}
            {isModerator && <span className="mod-badge" title="Lumixo Moderator">🛡 MOD</span>}
          </div>
          {nickname && (
            <div className="contact-presence" style={{ opacity: 0.85 }}>
              {resolveDisplayName(profile, { fallback: handle || 'Contact' })}
              {handle ? ` · ${handle}` : ''}
            </div>
          )}
          <div className="contact-presence">{presence}</div>
        </div>

        <div className="contact-actions">
          {onMessage && <button onClick={onMessage}><span>💬</span>Message</button>}
          {conversationId && <button onClick={toggleMute}><span>{muted ? '🔔' : '🔕'}</span>{muted ? 'Unmute' : 'Mute'}</button>}
          {onCall && <button onClick={onCall}><span>📞</span>Call</button>}
          {onVideo && <button onClick={onVideo}><span>🎥</span>Video</button>}
        </div>

        <div className="contact-fields">
          <button
            type="button"
            className="contact-field"
            onClick={editNickname}
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', background: 'inherit', font: 'inherit', color: 'inherit' }}
          >
            <div className="contact-field-val">{nickname || 'Add nickname'}</div>
            <div className="contact-field-label">
              {nickname ? 'Nickname · only you see this' : 'Nickname · private to you'}
            </div>
          </button>
          {handle && (
            <div className="contact-field"><div className="contact-field-val">{handle}</div><div className="contact-field-label">Username</div></div>
          )}
          {profile.about && (
            <div className="contact-field"><div className="contact-field-val">{profile.about}</div><div className="contact-field-label">About</div></div>
          )}
          {profile.phone && (
            <div className="contact-field"><div className="contact-field-val">{profile.phone}</div><div className="contact-field-label">Phone</div></div>
          )}
        </div>

        {conversationId && (
          <div className="contact-disappear">
            <div className="contact-disappear-head">
              <span className="contact-disappear-icon">⏳</span>
              <div className="contact-disappear-text">
                <div className="contact-disappear-title">Disappearing messages</div>
                <div className="contact-disappear-hint">
                  New messages in this chat disappear after the selected duration.
                </div>
              </div>
              <select
                className="contact-disappear-select"
                value={disappearSecs}
                onChange={(e) => chooseDisappearing(Number(e.target.value))}
                aria-label="Disappearing messages timer"
              >
                <option value={0}>Off</option>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h * 3600}>{h} hour{h > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {conversationId && (
          <div className="contact-disappear">
            <div className="contact-disappear-head">
              <span className="contact-disappear-icon">🔒</span>
              <div className="contact-disappear-text">
                <div className="contact-disappear-title">Chat lock</div>
                <div className="contact-disappear-hint">
                  {lockAvailable
                    ? "Lock this chat behind your device's fingerprint, face unlock, or PIN."
                    : 'Set up a screen lock on this device to use Chat Lock.'}
                </div>
              </div>
              <button
                className={`contact-lock-btn ${locked ? 'on' : ''}`}
                onClick={toggleLock}
                disabled={!lockAvailable}
                aria-pressed={locked}
              >
                {locked ? 'Locked' : 'Lock'}
              </button>
            </div>
          </div>
        )}

        {conversationId && (photos.length > 0 || docs.length > 0) && (
          <div className="contact-media">
            <div className="contact-media-head">
              <span>Media, links and docs</span>
              <span className="contact-media-count">{photos.length + docs.length}</span>
            </div>
            {photos.length > 0 && (
              <div className="contact-media-grid">
                {photos.slice(0, 12).map((m) => {
                  const href = safeHref(m.media_url);
                  if (!href) return null;
                  return (
                    <button
                      key={m.id}
                      className="contact-media-thumb"
                      style={{ backgroundImage: safeCssUrl(href) }}
                      onClick={() => setLightbox(href)}
                      aria-label="View photo"
                    />
                  );
                })}
              </div>
            )}
            {docs.length > 0 && (
              <div className="contact-doc-list">
                {docs.slice(0, 8).map((m) => {
                  const href = safeHref(m.media_url);
                  if (!href) return null;
                  return (
                    <a key={m.id} href={href} target="_blank" rel="noreferrer" className="contact-doc">
                      <span className="contact-doc-icon">📎</span>
                      <span className="contact-doc-name">{m.content || 'Attachment'}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {blocked && <div className="contact-blocked-note">🚫 You have blocked this user.</div>}
        {toast && <div className="contact-toast">{toast}</div>}
      </motion.div>

      {lightboxIndex >= 0 && (
        <MediaLightbox
          items={galleryItems}
          index={lightboxIndex}
          onClose={() => setLightbox(null)}
          onIndexChange={(idx) => setLightbox(galleryItems[idx]?.url ?? null)}
        />
      )}
    </motion.div>
  );
}
