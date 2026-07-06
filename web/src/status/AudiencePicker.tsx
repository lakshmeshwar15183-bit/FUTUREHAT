// FUTUREHAT web — Status audience picker (WhatsApp "Status privacy").
// Choose who can see a status: Everyone / My contacts / Except… / Only share with…
// Except/Only reveal a searchable multi-select of contacts (people you share a
// direct conversation with). Per-post enforcement is snapshotted server-side
// (see shared/api.ts createStatus) — this only collects intent.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { getMyConversations } from '@shared/api';
import type { StatusAudience, Profile } from '@shared/types';
import { useEscapeToClose } from '../useEscapeToClose';
import './status.css';

interface Props {
  audience: StatusAudience;
  memberIds: string[];
  myId: string;
  onClose: () => void;
  onSave: (audience: StatusAudience, memberIds: string[]) => void;
}

const OPTIONS: { key: StatusAudience; label: string; sub: string }[] = [
  { key: 'everyone', label: 'Everyone', sub: 'Anyone on FUTUREHAT can see' },
  { key: 'contacts', label: 'My contacts', sub: 'People you chat with' },
  { key: 'except', label: 'My contacts except…', sub: 'Hide from some contacts' },
  { key: 'only', label: 'Only share with…', sub: 'Show to selected contacts' },
];

export function AudiencePicker({ audience, memberIds, myId, onClose, onSave }: Props) {
  const [sel, setSel] = useState<StatusAudience>(audience);
  const [members, setMembers] = useState<Set<string>>(new Set(memberIds));
  const [contacts, setContacts] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEscapeToClose(onClose);

  const needsList = sel === 'except' || sel === 'only';

  // Lazily load contacts (direct-conversation peers) the first time a list mode shows.
  useEffect(() => {
    if (!needsList || contacts.length || loading) return;
    let alive = true;
    setLoading(true);
    getMyConversations(supabase)
      .then((convs) => {
        const seen = new Map<string, Profile>();
        for (const c of convs) {
          if (c.conversation.type !== 'direct') continue;
          for (const p of c.participants) {
            if (p.id !== myId && !seen.has(p.id)) seen.set(p.id, p);
          }
        }
        const list = [...seen.values()].sort((a, b) =>
          (a.display_name ?? '').localeCompare(b.display_name ?? ''),
        );
        if (alive) setContacts(list);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => (c.display_name ?? '').toLowerCase().includes(q));
  }, [contacts, query]);

  function toggle(id: string) {
    setMembers((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function save() {
    onSave(sel, needsList ? [...members] : []);
    onClose();
  }

  const canSave = !needsList || members.size > 0;

  return (
    <div className="audience-overlay" onClick={onClose}>
      <div className="audience-modal" onClick={(e) => e.stopPropagation()}>
        <div className="audience-header">
          <button className="audience-close" onClick={onClose} aria-label="Close">✕</button>
          <h3>Status privacy</h3>
          <button className="audience-done" onClick={save} disabled={!canSave}>Done</button>
        </div>

        <div className="audience-body">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`audience-opt ${sel === o.key ? 'on' : ''}`}
              onClick={() => setSel(o.key)}
            >
              <span className="audience-radio" aria-hidden>{sel === o.key ? '●' : '○'}</span>
              <span className="audience-opt-body">
                <span className="audience-opt-label">{o.label}</span>
                <span className="audience-opt-sub">{o.sub}</span>
              </span>
            </button>
          ))}

          {needsList && (
            <div className="audience-list">
              <input
                className="audience-search"
                placeholder="Search contacts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="audience-list-label">
                {sel === 'except' ? 'HIDE STATUS FROM' : 'SHARE STATUS WITH'}
                {members.size > 0 ? ` · ${members.size}` : ''}
              </div>
              {loading && <div className="audience-empty">Loading contacts…</div>}
              {!loading && filtered.length === 0 && (
                <div className="audience-empty">
                  {query ? 'No matching contacts.' : 'No contacts yet — start a chat first.'}
                </div>
              )}
              {filtered.map((c) => {
                const on = members.has(c.id);
                return (
                  <button key={c.id} className="audience-contact" onClick={() => toggle(c.id)}>
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" className="audience-contact-avatar" />
                    ) : (
                      <div className="audience-contact-avatar fallback">{(c.display_name || '?')[0]}</div>
                    )}
                    <span className="audience-contact-name">{c.display_name || 'FUTUREHAT user'}</span>
                    <span className={`audience-check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
