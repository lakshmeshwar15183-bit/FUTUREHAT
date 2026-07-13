// Lumixo web — WhatsApp-class Group Info modal (full management).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from './supabase';
import {
  getGroupConversation,
  getGroupMembers,
  getMyGroupRole,
  updateGroupInfo,
  setGroupPermissions,
  addGroupMembers,
  removeGroupMember,
  promoteGroupAdmin,
  demoteGroupAdmin,
  transferGroupOwnership,
  leaveGroup,
  deleteGroup,
  getOrCreateGroupInvite,
  resetGroupInvite,
  revokeGroupInvite,
  groupInviteUrl,
  listGroupJoinRequests,
  resolveGroupJoinRequest,
  permissionsFromConversation,
  canEditGroupInfo,
  canAddMembers,
  canManageAdmins,
  canManageDisappearing,
  isGroupAdminRole,
  isGroupOwnerRole,
} from '@shared/groupsApi';
import {
  getSharedMedia,
  searchProfiles,
  getCurrentUser,
  getDisappearing,
  setConversationDisappearing,
  isVideoMessage,
} from '@shared/api';
import { deleteConversationForMe } from '@shared/messageExtras';
import {
  getMutedIds,
  muteConversation,
  unmuteConversation,
  submitReport,
} from '@shared/supportApi';
import type {
  Conversation,
  GroupMember,
  GroupJoinRequest,
  GroupPermissions,
  ParticipantRole,
  Profile,
  Message,
  UUID,
} from '@shared/types';
import { useEscapeToClose } from './useEscapeToClose';
import { safeHref, safeMediaSrc } from './util/safeUrl';
import './GroupInfoModal.css';
import './GroupModal.css';

interface Props {
  conversationId: UUID;
  onClose: () => void;
  onLeft?: () => void;
  onUpdated?: (name: string) => void;
}

type Panel =
  | 'main'
  | 'edit'
  | 'add'
  | 'invite'
  | 'perms'
  | 'disappear'
  | 'media'
  | 'docs'
  | 'member';

const DISAPPEAR = [
  { secs: 0, label: 'Off' },
  ...Array.from({ length: 8 }, (_, i) => ({
    secs: (i + 1) * 3600,
    label: `${i + 1} hour${i ? 's' : ''}`,
  })),
];

export function GroupInfoModal({ conversationId, onClose, onLeft, onUpdated }: Props) {
  useEscapeToClose(onClose);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<ParticipantRole | null>(null);
  const [myId, setMyId] = useState<UUID | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [perms, setPerms] = useState<GroupPermissions>(permissionsFromConversation(null));
  const [joinRequests, setJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [media, setMedia] = useState<Message[]>([]);
  const [docs, setDocs] = useState<Message[]>([]);
  const [disappearSecs, setDisappearSecs] = useState(0);
  const [panel, setPanel] = useState<Panel>('main');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  // Memoized blob URL — createObjectURL on every render leaked memory.
  const iconPreviewUrl = useMemo(
    () => (iconFile ? URL.createObjectURL(iconFile) : null),
    [iconFile],
  );
  useEffect(() => {
    return () => {
      if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
    };
  }, [iconPreviewUrl]);

  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [addSelected, setAddSelected] = useState<Profile[]>([]);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);

  const reload = useCallback(async () => {
    try {
      const user = await getCurrentUser(supabase);
      setMyId(user?.id ?? null);
      const [conv, mems, role, mids, shared, dsecs] = await Promise.all([
        getGroupConversation(supabase, conversationId),
        getGroupMembers(supabase, conversationId),
        getMyGroupRole(supabase, conversationId),
        getMutedIds(supabase),
        getSharedMedia(supabase, conversationId, 80),
        getDisappearing(supabase, conversationId),
      ]);
      setConversation(conv);
      setMembers(mems);
      setMyRole(role);
      setPerms(permissionsFromConversation(conv));
      setMuted(mids.includes(conversationId));
      setDisappearSecs(dsecs);
      setMedia(shared.filter((m) => m.type === 'image' || isVideoMessage(m)));
      setDocs(shared.filter((m) => m.type === 'file' && !isVideoMessage(m)));
      if (isGroupAdminRole(role)) {
        setJoinRequests(await listGroupJoinRequests(supabase, conversationId));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load group');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (panel !== 'add') return;
    const q = addQuery.trim();
    if (!q) {
      setAddResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const data = await searchProfiles(supabase, q);
      const existing = new Set(members.map((m) => m.userId));
      setAddResults(data.filter((p) => !existing.has(p.id) && p.id !== myId));
    }, 250);
    return () => clearTimeout(t);
  }, [addQuery, panel, members, myId]);

  const isAdmin = isGroupAdminRole(myRole);
  const isOwner = isGroupOwnerRole(myRole);
  const canEdit = canEditGroupInfo(myRole, perms);
  const canAdd = canAddMembers(myRole, perms);
  const canDisappear = canManageDisappearing(myRole, perms);

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      let avatarUrl: string | null | undefined = undefined;
      if (iconFile) {
        const user = await getCurrentUser(supabase);
        if (!user) throw new Error('Not authenticated');
        const ext = (iconFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${user.id}/group-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, iconFile, { upsert: true, contentType: iconFile.type || 'image/jpeg' });
        if (upErr) throw upErr;
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      const { error: err } = await updateGroupInfo(supabase, conversationId, {
        name: editName.trim(),
        description: editDesc.trim() || null,
        avatarUrl,
      });
      if (err) throw err;
      onUpdated?.(editName.trim());
      setPanel('main');
      setIconFile(null);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    } finally {
      setBusy(false);
    }
  }

  async function doAdd() {
    if (!addSelected.length || busy) return;
    setBusy(true);
    const { error: err } = await addGroupMembers(
      supabase,
      conversationId,
      addSelected.map((p) => p.id),
    );
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAddSelected([]);
    setAddQuery('');
    setPanel('main');
    await reload();
  }

  async function openInvite() {
    setPanel('invite');
    setBusy(true);
    const { token, error: err } = await getOrCreateGroupInvite(supabase, conversationId);
    setBusy(false);
    if (err) {
      setError(err.message);
      setPanel('main');
      return;
    }
    setInviteToken(token);
  }

  async function toggleMute() {
    if (muted) {
      await unmuteConversation(supabase, conversationId);
      setMuted(false);
    } else {
      await muteConversation(supabase, conversationId);
      setMuted(true);
    }
  }

  async function togglePerm(key: keyof GroupPermissions, value: boolean) {
    setPerms((p) => ({ ...p, [key]: value }));
    const { error: err } = await setGroupPermissions(supabase, conversationId, { [key]: value });
    if (err) {
      setError(err.message);
      await reload();
    }
  }

  async function memberAction(action: string) {
    if (!selectedMember) return;
    const m = selectedMember;
    setBusy(true);
    setError('');
    let err: Error | null = null;
    if (action === 'promote') err = (await promoteGroupAdmin(supabase, conversationId, m.userId)).error;
    else if (action === 'demote') err = (await demoteGroupAdmin(supabase, conversationId, m.userId)).error;
    else if (action === 'remove') err = (await removeGroupMember(supabase, conversationId, m.userId)).error;
    else if (action === 'transfer') err = (await transferGroupOwnership(supabase, conversationId, m.userId)).error;
    setBusy(false);
    if (err) setError(err.message);
    else {
      setSelectedMember(null);
      setPanel('main');
      await reload();
    }
  }

  async function onLeave() {
    if (!confirm('Exit group? You will stop receiving messages.')) return;
    const { error: err } = await leaveGroup(supabase, conversationId);
    if (err) setError(err.message);
    else {
      onLeft?.();
      onClose();
    }
  }

  async function onDelete() {
    if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
    const { error: err } = await deleteGroup(supabase, conversationId);
    if (err) setError(err.message);
    else {
      onLeft?.();
      onClose();
    }
  }

  async function onClear() {
    if (!confirm('Clear chat for you only?')) return;
    const { error: err } = await deleteConversationForMe(supabase, conversationId);
    if (err) setError(err.message);
    else {
      onLeft?.();
      onClose();
    }
  }

  async function onReport() {
    if (!confirm('Report this group?')) return;
    const { error: err } = await submitReport(
      supabase,
      'conversation',
      conversationId,
      'other',
      'Reported from Group Info',
    );
    if (err) setError(err.message);
    else alert('Report submitted. Thank you.');
  }

  async function onExport() {
    const { data } = await supabase
      .from('messages')
      .select('content, type, created_at, sender_id, is_deleted')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(500);
    const nameById = new Map(members.map((m) => [m.userId, m.profile.display_name || 'User']));
    const lines = (data || []).map((m: any) => {
      const who = nameById.get(m.sender_id) || 'System';
      const body = m.type === 'text' || m.type === 'system' ? m.content : `[${m.type}]`;
      return `[${new Date(m.created_at).toLocaleString()}] ${who}: ${body || ''}`;
    });
    const blob = new Blob(
      [`Lumixo — ${conversation?.name || 'Group'}\n\n${lines.join('\n')}`],
      { type: 'text/plain' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${conversation?.name || 'group'}-export.txt`;
    a.click();
  }

  async function resolveReq(userId: UUID, approve: boolean) {
    const { error: err } = await resolveGroupJoinRequest(supabase, conversationId, userId, approve);
    if (err) setError(err.message);
    else await reload();
  }

  const inviteLink = inviteToken ? groupInviteUrl(inviteToken) : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card gi-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button
            className="close-btn"
            onClick={() => (panel === 'main' ? onClose() : setPanel('main'))}
            aria-label="Back"
          >
            {panel === 'main' ? '✕' : '←'}
          </button>
          <h2>
            {panel === 'main' && 'Group info'}
            {panel === 'edit' && 'Edit group'}
            {panel === 'add' && 'Add members'}
            {panel === 'invite' && 'Invite link'}
            {panel === 'perms' && 'Group permissions'}
            {panel === 'disappear' && 'Disappearing messages'}
            {panel === 'media' && 'Media'}
            {panel === 'docs' && 'Documents'}
            {panel === 'member' && (selectedMember?.profile.display_name || 'Member')}
          </h2>
          <span style={{ width: 28 }} />
        </div>

        {error && <div className="error-msg gi-error">{error}</div>}

        {loading ? (
          <div className="gi-loading">Loading…</div>
        ) : !conversation ? (
          <div className="gi-loading">Group not found</div>
        ) : panel === 'main' ? (
          <div className="gi-body">
            <div className="gi-hero">
              <div className="gi-avatar">
                {safeMediaSrc(conversation.avatar_url) ? (
                  <img src={safeMediaSrc(conversation.avatar_url)!} alt="" />
                ) : (
                  <span>{(conversation.name || 'G')[0]}</span>
                )}
              </div>
              <div className="gi-name">{conversation.name}</div>
              <div className="gi-meta">
                Group · {members.length} member{members.length === 1 ? '' : 's'}
              </div>
              {conversation.description && (
                <div className="gi-desc">{conversation.description}</div>
              )}
            </div>

            <div className="gi-quick">
              {canAdd && (
                <button type="button" onClick={() => setPanel('add')}>
                  👤+ Add
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={openInvite}>
                  🔗 Invite
                </button>
              )}
              <button type="button" onClick={toggleMute}>
                {muted ? '🔔 Unmute' : '🔕 Mute'}
              </button>
            </div>

            <section className="gi-section">
              <h3>Media, links and docs</h3>
              <button type="button" className="gi-row" onClick={() => setPanel('media')}>
                <span>🖼 Media</span>
                <span className="gi-val">{media.length}</span>
              </button>
              <button type="button" className="gi-row" onClick={() => setPanel('docs')}>
                <span>📄 Docs</span>
                <span className="gi-val">{docs.length}</span>
              </button>
            </section>

            {isAdmin && joinRequests.length > 0 && (
              <section className="gi-section">
                <h3>Join requests ({joinRequests.length})</h3>
                {joinRequests.map((r) => (
                  <div key={r.userId} className="gi-member">
                    <div className="gi-member-av">{(r.displayName || '?')[0]}</div>
                    <div className="gi-member-info">
                      <div>{r.displayName || 'User'}</div>
                      {r.username && <small>@{r.username}</small>}
                    </div>
                    <button type="button" className="gi-mini" onClick={() => resolveReq(r.userId, true)}>
                      ✓
                    </button>
                    <button type="button" className="gi-mini danger" onClick={() => resolveReq(r.userId, false)}>
                      ✕
                    </button>
                  </div>
                ))}
              </section>
            )}

            <section className="gi-section">
              <h3>{members.length} members</h3>
              {members.map((m) => (
                <button
                  type="button"
                  key={m.userId}
                  className="gi-member"
                  onClick={() => {
                    if (m.userId === myId) return;
                    setSelectedMember(m);
                    setPanel('member');
                  }}
                >
                  <div className="gi-member-av">
                    {safeMediaSrc(m.profile.avatar_url) ? (
                      <img src={safeMediaSrc(m.profile.avatar_url)!} alt="" />
                    ) : (
                      (m.profile.display_name || '?')[0]
                    )}
                  </div>
                  <div className="gi-member-info">
                    <div>{m.userId === myId ? 'You' : m.profile.display_name || 'User'}</div>
                    {m.role === 'super_admin' && <small className="gi-role">Group owner</small>}
                    {m.role === 'admin' && <small className="gi-role">Group admin</small>}
                  </div>
                </button>
              ))}
            </section>

            <section className="gi-section">
              <h3>Settings</h3>
              {canEdit && (
                <button
                  type="button"
                  className="gi-row"
                  onClick={() => {
                    setEditName(conversation.name || '');
                    setEditDesc(conversation.description || '');
                    setPanel('edit');
                  }}
                >
                  Edit group info
                </button>
              )}
              {isAdmin && (
                <button type="button" className="gi-row" onClick={() => setPanel('perms')}>
                  Group permissions
                </button>
              )}
              {isAdmin && (
                <button type="button" className="gi-row" onClick={openInvite}>
                  Invite via link / QR
                </button>
              )}
              <button
                type="button"
                className="gi-row"
                onClick={() => {
                  if (!canDisappear) {
                    setError('Only admins can change disappearing messages');
                    return;
                  }
                  setPanel('disappear');
                }}
              >
                <span>Disappearing messages</span>
                <span className="gi-val">
                  {DISAPPEAR.find((d) => d.secs === disappearSecs)?.label || 'Off'}
                </span>
              </button>
              <button
                type="button"
                className="gi-row"
                onClick={() =>
                  alert(
                    'Messages are protected with TLS in transit. Lumixo enforces Row Level Security so only group members can read this chat.',
                  )
                }
              >
                Encryption
              </button>
              <button type="button" className="gi-row" onClick={onExport}>
                Export chat
              </button>
              <button type="button" className="gi-row" onClick={onClear}>
                Clear chat
              </button>
            </section>

            <section className="gi-section">
              <button type="button" className="gi-row danger" onClick={onLeave}>
                Exit group
              </button>
              <button type="button" className="gi-row danger" onClick={onReport}>
                Report group
              </button>
              {isOwner && (
                <button type="button" className="gi-row danger" onClick={onDelete}>
                  Delete group
                </button>
              )}
            </section>
          </div>
        ) : panel === 'edit' ? (
          <form className="gi-body gi-form" onSubmit={saveEdit}>
            <label className="group-icon-picker">
              <div className="group-icon-preview">
                {iconPreviewUrl ? (
                  <img src={iconPreviewUrl} alt="" />
                ) : conversation.avatar_url && safeHref(conversation.avatar_url) ? (
                  <img src={safeHref(conversation.avatar_url)} alt="" />
                ) : (
                  <span>📷</span>
                )}
              </div>
              <span className="group-icon-hint">Change photo</span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => setIconFile(e.target.files?.[0] || null)}
              />
            </label>
            <label>
              Group name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required maxLength={100} />
            </label>
            <label>
              Description
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || !editName.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        ) : panel === 'add' ? (
          <div className="gi-body">
            <input
              className="gi-search"
              placeholder="Search contacts…"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
            />
            {addSelected.length > 0 && (
              <div className="selected-users">
                {addSelected.map((u) => (
                  <div key={u.id} className="selected-user">
                    {u.display_name}
                    <button
                      type="button"
                      onClick={() => setAddSelected((s) => s.filter((x) => x.id !== u.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="user-search-results">
              {addResults.map((u) => {
                const on = addSelected.some((s) => s.id === u.id);
                return (
                  <div
                    key={u.id}
                    className={`user-result ${on ? 'selected' : ''}`}
                    onClick={() =>
                      setAddSelected((prev) =>
                        on ? prev.filter((x) => x.id !== u.id) : [...prev, u],
                      )
                    }
                  >
                    <div className="avatar">{u.display_name?.[0] || '?'}</div>
                    <div className="user-info">
                      <div className="user-name">{u.display_name || (u.username ? `@${u.username}` : 'Contact')}</div>
                      <div className="user-username">@{u.username || u.id.slice(0, 8)}</div>
                    </div>
                    {on && <div className="check-mark">✓</div>}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="primary gi-full"
              disabled={!addSelected.length || busy}
              onClick={doAdd}
            >
              {busy ? 'Adding…' : `Add ${addSelected.length || ''}`.trim()}
            </button>
          </div>
        ) : panel === 'invite' ? (
          <div className="gi-body">
            {busy ? (
              <div className="gi-loading">Loading link…</div>
            ) : inviteToken ? (
              <>
                <p className="gi-desc">
                  Anyone with this link can join the group
                  {perms.approveNewMembers ? ' (admin approval required)' : ''}.
                </p>
                <div className="invite-link-row">
                  <input
                    className="invite-link"
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="invite-copy"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      alert('Copied');
                    }}
                  >
                    Copy
                  </button>
                </div>
                <div className="gi-qr">
                  <div className="gi-qr-box">
                    <code>{inviteToken}</code>
                  </div>
                  <p className="gi-desc">Share the link or show this invite code (QR payload).</p>
                </div>
                <button
                  type="button"
                  className="gi-row"
                  onClick={async () => {
                    const { token, error: err } = await resetGroupInvite(supabase, conversationId);
                    if (err) setError(err.message);
                    else setInviteToken(token);
                  }}
                >
                  Reset link
                </button>
                <button
                  type="button"
                  className="gi-row danger"
                  onClick={async () => {
                    const { error: err } = await revokeGroupInvite(supabase, conversationId);
                    if (err) setError(err.message);
                    else {
                      setInviteToken(null);
                      setPanel('main');
                    }
                  }}
                >
                  Revoke link
                </button>
              </>
            ) : (
              <div className="gi-loading">No active link</div>
            )}
          </div>
        ) : panel === 'perms' ? (
          <div className="gi-body">
            {(
              [
                ['onlyAdminsCanSend', 'Send messages', 'Only admins can send messages'],
                ['onlyAdminsCanEditInfo', 'Edit group info', 'Only admins can edit name/photo/description'],
                ['onlyAdminsCanAddMembers', 'Add other members', 'Only admins can add members'],
                ['onlyAdminsCanPin', 'Pin messages', 'Only admins can pin messages'],
                ['onlyAdminsManageDisappearing', 'Disappearing messages', 'Only admins can change timer'],
                ['approveNewMembers', 'Approve new members', 'Admins approve invite-link joins'],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="gi-perm">
                <div>
                  <strong>{label}</strong>
                  <small>{perms[key] ? hint : 'All participants'}</small>
                </div>
                <input
                  type="checkbox"
                  checked={!!perms[key]}
                  onChange={(e) => togglePerm(key, e.target.checked)}
                />
              </label>
            ))}
            <label className="gi-perm">
              <div>
                <strong>Message history for new members</strong>
                <small>
                  {perms.memberHistoryVisible
                    ? 'New members can see previous messages'
                    : 'New members only see messages after they join'}
                </small>
              </div>
              <input
                type="checkbox"
                checked={perms.memberHistoryVisible}
                onChange={(e) => togglePerm('memberHistoryVisible', e.target.checked)}
              />
            </label>
            <p className="gi-desc">Only the group owner can promote or demote admins.</p>
          </div>
        ) : panel === 'disappear' ? (
          <div className="gi-body">
            {DISAPPEAR.map((o) => (
              <button
                key={o.secs}
                type="button"
                className="gi-row"
                onClick={async () => {
                  const { error: err } = await setConversationDisappearing(
                    supabase,
                    conversationId,
                    o.secs,
                  );
                  if (err) setError(err.message);
                  else {
                    setDisappearSecs(o.secs);
                    setPanel('main');
                  }
                }}
              >
                <span>{o.label}</span>
                {disappearSecs === o.secs && <span className="gi-val">✓</span>}
              </button>
            ))}
          </div>
        ) : panel === 'media' || panel === 'docs' ? (
          <div className="gi-body">
            {(panel === 'media' ? media : docs).length === 0 ? (
              <div className="gi-loading">Nothing here yet</div>
            ) : (
              <div className={panel === 'media' ? 'gi-media-grid' : 'gi-docs'}>
                {(panel === 'media' ? media : docs).map((m) => {
                  // XSS: media_url is user-controlled; never put javascript: in href/src.
                  const href = safeHref(m.media_url);
                  return panel === 'media' ? (
                    href ? (
                      <a
                        key={m.id}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="gi-media-cell"
                      >
                        {m.type === 'image' ? (
                          <img src={href} alt="" />
                        ) : (
                          <span>🎬</span>
                        )}
                      </a>
                    ) : (
                      <div key={m.id} className="gi-media-cell" aria-hidden>
                        <span>🎬</span>
                      </div>
                    )
                  ) : href ? (
                    <a
                      key={m.id}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="gi-row"
                    >
                      📄 {m.content || m.media_url?.split('/').pop() || 'File'}
                    </a>
                  ) : (
                    <div key={m.id} className="gi-row">
                      📄 {m.content || 'File'}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : panel === 'member' && selectedMember ? (
          <div className="gi-body">
            <div className="gi-hero">
              <div className="gi-avatar">
                {safeMediaSrc(selectedMember.profile.avatar_url) ? (
                  <img src={safeMediaSrc(selectedMember.profile.avatar_url)!} alt="" />
                ) : (
                  <span>{(selectedMember.profile.display_name || '?')[0]}</span>
                )}
              </div>
              <div className="gi-name">{selectedMember.profile.display_name}</div>
            </div>
            {canManageAdmins(myRole) && selectedMember.role === 'member' && (
              <button type="button" className="gi-row" onClick={() => memberAction('promote')}>
                Make group admin
              </button>
            )}
            {canManageAdmins(myRole) && selectedMember.role === 'admin' && (
              <button type="button" className="gi-row" onClick={() => memberAction('demote')}>
                Dismiss as admin
              </button>
            )}
            {isOwner && (
              <button type="button" className="gi-row" onClick={() => memberAction('transfer')}>
                Transfer ownership
              </button>
            )}
            {isAdmin &&
              selectedMember.role !== 'super_admin' &&
              !(myRole === 'admin' && selectedMember.role === 'admin') && (
                <button type="button" className="gi-row danger" onClick={() => memberAction('remove')}>
                  Remove from group
                </button>
              )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default GroupInfoModal;
