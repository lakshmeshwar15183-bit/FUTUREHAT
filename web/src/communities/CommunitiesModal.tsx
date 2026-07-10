// Lumixo — Communities: list & create communities, browse channels (each
// backed by a conversation) and events (create + RSVP). Opening a channel hands
// its conversation id back to the app, which selects it in the main chat.
// Parity with the Android Communities tab + CommunityDetail screen.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import {
  getMyCommunities, createCommunity, joinCommunity,
  getChannels, createChannel,
  getCommunityEvents, createEvent, rsvpEvent,
  getCommunityMembers,
} from '@shared/communitiesApi';
import type { Community, Channel, CommunityEvent, CommunityMember } from '@shared/communitiesApi';
import { modalBackdrop, modalPanel } from '../motion';
import './CommunitiesModal.css';

type Tab = 'channels' | 'events' | 'members';

export function CommunitiesModal({ onClose, onOpenChannel }: {
  onClose: () => void;
  onOpenChannel: (conversationId: string) => void;
}) {
  const { profile } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [active, setActive] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // create-community form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string>('');
  const [joinId, setJoinId] = useState('');

  function pickIcon(file: File | null) {
    setIconFile(file);
    setIconPreview(file ? URL.createObjectURL(file) : '');
  }

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2400); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (active) setActive(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    setCommunities(await getMyCommunities(supabase));
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return flash('Name your community.');
    let avatarUrl: string | null = null;
    if (iconFile) {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return flash('Not authenticated.');
      const ext = (iconFile.name.split('.').pop() || 'jpg').toLowerCase();
      // avatars bucket RLS requires the first path segment to equal the uploader's id.
      const path = `${uid}/community-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, iconFile, { upsert: true, contentType: iconFile.type || 'image/jpeg' });
      if (upErr) return flash(upErr.message || 'Could not upload icon.');
      avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }
    const { community, error } = await createCommunity(supabase, newName.trim(), newDesc.trim() || undefined, avatarUrl);
    if (error || !community) return flash(error?.message || 'Could not create community.');
    setNewName(''); setNewDesc(''); pickIcon(null); setCreating(false);
    await load();
    setActive(community);
  }

  async function handleJoin() {
    const id = joinId.trim();
    if (!id) return;
    const { error } = await joinCommunity(supabase, id);
    if (error) return flash(error.message || 'Could not join — check the ID.');
    setJoinId('');
    await load();
    flash('Joined community.');
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="comm-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {!active ? (
          <>
            <h2 className="comm-title">🌐 Communities</h2>
            {loading ? (
              <div className="comm-empty">Loading…</div>
            ) : communities.length === 0 ? (
              <div className="comm-empty">You haven’t joined any communities yet.</div>
            ) : (
              <div className="comm-list">
                {communities.map((c) => (
                  <button key={c.id} className="comm-card" onClick={() => setActive(c)}>
                    <div className="comm-avatar">{c.name[0]?.toUpperCase()}</div>
                    <div className="comm-meta">
                      <div className="comm-name">{c.name}</div>
                      <div className="comm-desc">{c.description || 'No description'}</div>
                    </div>
                    <span className="comm-chevron">›</span>
                  </button>
                ))}
              </div>
            )}

            <div className="comm-create">
              {creating ? (
                <>
                  <label className="comm-icon-picker">
                    <div className="comm-icon-preview">
                      {iconPreview ? <img src={iconPreview} alt="Community icon" /> : <span>📷</span>}
                    </div>
                    <span>{iconFile ? 'Change icon' : 'Add icon (optional)'}</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pickIcon(e.target.files?.[0] || null)} />
                  </label>
                  <input className="comm-input" placeholder="Community name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
                  <input className="comm-input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} maxLength={140} />
                  <div className="comm-row">
                    <button className="comm-btn primary" onClick={handleCreate}>Create</button>
                    <button className="comm-btn" onClick={() => setCreating(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <button className="comm-btn primary wide" onClick={() => setCreating(true)}>+ New community</button>
              )}
              <div className="comm-join">
                <input className="comm-input" placeholder="Join by community ID" value={joinId} onChange={(e) => setJoinId(e.target.value)} />
                <button className="comm-btn" onClick={handleJoin}>Join</button>
              </div>
            </div>
          </>
        ) : (
          <CommunityDetail
            community={active}
            myId={profile?.id}
            onBack={() => setActive(null)}
            onOpenChannel={(cid) => { onOpenChannel(cid); onClose(); }}
            flash={flash}
          />
        )}

        {toast && <div className="comm-toast">{toast}</div>}
      </motion.div>
    </motion.div>
  );
}

function CommunityDetail({ community, myId, onBack, onOpenChannel, flash }: {
  community: Community;
  myId?: string;
  onBack: () => void;
  onOpenChannel: (conversationId: string) => void;
  flash: (m: string) => void;
}) {
  const isAdmin = community.owner_id === myId;
  const [tab, setTab] = useState<Tab>('channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // composer state
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [chName, setChName] = useState('');
  const [chKind, setChKind] = useState<Channel['kind']>('text');
  const [showEventForm, setShowEventForm] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evWhen, setEvWhen] = useState('');
  const [evLoc, setEvLoc] = useState('');

  useEffect(() => { load(); }, [community.id]);
  async function load() {
    setLoading(true);
    const [ch, ev, mem] = await Promise.all([
      getChannels(supabase, community.id),
      getCommunityEvents(supabase, community.id),
      getCommunityMembers(supabase, community.id),
    ]);
    setChannels(ch); setEvents(ev); setMembers(mem); setLoading(false);
  }

  const filteredMembers = members.filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return true;
    const p = m.profile;
    return (p?.display_name || '').toLowerCase().includes(q) || (p?.username || '').toLowerCase().includes(q);
  });
  const roleOf = (m: CommunityMember) => (m.user_id === community.owner_id ? 'Owner' : m.role === 'admin' ? 'Admin' : null);

  async function addChannel() {
    if (!chName.trim()) return flash('Name the channel.');
    const { channel, error } = await createChannel(supabase, community.id, chName.trim(), chKind);
    if (error || !channel) return flash(error?.message || 'Could not create channel.');
    setChName(''); setShowChannelForm(false);
    setChannels((c) => [...c, channel]);
  }

  async function addEvent() {
    if (!evTitle.trim() || !evWhen) return flash('Add a title and time.');
    const { event, error } = await createEvent(supabase, {
      communityId: community.id,
      title: evTitle.trim(),
      location: evLoc.trim() || undefined,
      startsAt: new Date(evWhen).toISOString(),
    });
    if (error || !event) return flash(error?.message || 'Could not create event.');
    setEvTitle(''); setEvWhen(''); setEvLoc(''); setShowEventForm(false);
    setEvents((e) => [...e, event].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
  }

  async function rsvp(eventId: string, status: 'going' | 'maybe' | 'no') {
    const { error } = await rsvpEvent(supabase, eventId, status);
    flash(error ? 'Could not RSVP.' : `RSVP: ${status}`);
  }

  const kindIcon = (k: Channel['kind']) => (k === 'announcement' ? '📢' : k === 'broadcast' ? '📡' : '#');

  return (
    <>
      <div className="comm-detail-head">
        <button className="comm-back" onClick={onBack}>←</button>
        <div className="comm-avatar lg">{community.name[0]?.toUpperCase()}</div>
        <div>
          <div className="comm-name">{community.name}{isAdmin && <span className="comm-admin-badge">admin</span>}</div>
          <div className="comm-desc">{community.description || 'No description'}</div>
        </div>
      </div>

      <div className="comm-tabs">
        <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>Channels</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events</button>
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>
      </div>

      {loading ? <div className="comm-empty">Loading…</div> : tab === 'channels' ? (
        <div className="comm-section">
          {channels.length === 0 && <div className="comm-empty">No channels yet.</div>}
          {channels.map((ch) => (
            <button key={ch.id} className="channel-row" onClick={() => onOpenChannel(ch.conversation_id)}>
              <span className="channel-icon">{kindIcon(ch.kind)}</span>
              <span className="channel-name">{ch.name}</span>
              <span className="channel-kind">{ch.kind}</span>
            </button>
          ))}
          {isAdmin && (showChannelForm ? (
            <div className="comm-form">
              <input className="comm-input" placeholder="Channel name" value={chName} onChange={(e) => setChName(e.target.value)} maxLength={40} />
              <select className="comm-input" value={chKind} onChange={(e) => setChKind(e.target.value as Channel['kind'])}>
                <option value="text">Text</option>
                <option value="announcement">Announcement</option>
                <option value="broadcast">Broadcast</option>
              </select>
              <div className="comm-row">
                <button className="comm-btn primary" onClick={addChannel}>Add</button>
                <button className="comm-btn" onClick={() => setShowChannelForm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="comm-btn primary wide" onClick={() => setShowChannelForm(true)}>+ New channel</button>
          ))}
        </div>
      ) : tab === 'events' ? (
        <div className="comm-section">
          {events.length === 0 && <div className="comm-empty">No events scheduled.</div>}
          {events.map((ev) => (
            <div key={ev.id} className="event-card">
              <div className="event-title">{ev.title}</div>
              <div className="event-when">🗓️ {new Date(ev.starts_at).toLocaleString()}</div>
              {ev.location && <div className="event-loc">📍 {ev.location}</div>}
              <div className="event-rsvp">
                <button onClick={() => rsvp(ev.id, 'going')}>Going</button>
                <button onClick={() => rsvp(ev.id, 'maybe')}>Maybe</button>
                <button onClick={() => rsvp(ev.id, 'no')}>Can’t</button>
              </div>
            </div>
          ))}
          {showEventForm ? (
            <div className="comm-form">
              <input className="comm-input" placeholder="Event title" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} maxLength={80} />
              <input className="comm-input" type="datetime-local" value={evWhen} onChange={(e) => setEvWhen(e.target.value)} />
              <input className="comm-input" placeholder="Location (optional)" value={evLoc} onChange={(e) => setEvLoc(e.target.value)} />
              <div className="comm-row">
                <button className="comm-btn primary" onClick={addEvent}>Create</button>
                <button className="comm-btn" onClick={() => setShowEventForm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="comm-btn primary wide" onClick={() => setShowEventForm(true)}>+ New event</button>
          )}
        </div>
      ) : (
        <div className="comm-section">
          <input className="comm-input" placeholder="Search members" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} style={{ marginBottom: 8 }} />
          {filteredMembers.length === 0 && <div className="comm-empty">No members found.</div>}
          {filteredMembers.map((m) => (
            <div key={m.user_id} className="channel-row" style={{ cursor: 'default' }}>
              <span className="comm-avatar" style={{ width: 36, height: 36, fontSize: 15 }}>{m.profile?.display_name?.[0]?.toUpperCase() || '?'}</span>
              <span className="channel-name">
                {m.profile?.display_name || 'User'}{m.profile?.username ? ` · @${m.profile.username}` : ''}
              </span>
              {roleOf(m) && <span className="comm-admin-badge">{roleOf(m)}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
