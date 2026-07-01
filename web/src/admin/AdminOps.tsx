// FUTUREHAT — Admin ▸ operational tabs: Calls, Messages, Feature Flags, App
// management (announcements + kill-switch), Database Health, Audit Log, and the
// global search. Owner-only surfaces (flags, app mgmt, audit) are gated here AND
// server-side by the RPCs in 0013.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../supabase';
import {
  adminCallStats, adminMessageStats, adminDbHealth,
  getFeatureFlags, adminSetFeatureFlag, adminSetAppEnabled,
  getActiveAnnouncements, adminSendAnnouncement,
  adminAuditLog, adminGlobalSearch, adminDeleteMessage, adminDeleteCommunity,
} from '@shared/adminApi';
import type {
  AdminCallStats, AdminMessageStats, AdminDbHealth, FeatureFlag,
  Announcement, AuditEntry, AdminGlobalSearch as AdminGlobalSearchResult, AnnouncementKind,
} from '@shared/types';

// ── Calls ────────────────────────────────────────────────────────────────────
export function AdminCalls() {
  const [s, setS] = useState<AdminCallStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminCallStats(supabase).then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="admin-warn">{err}</div>;
  if (!s) return <div className="admin-empty">Loading call metrics…</div>;
  const cards = [
    ['Active voice', s.active_audio], ['Active video', s.active_video], ['Ringing', s.ringing],
    ['Failed calls', s.failed], ['ICE failures', s.ice_failures], ['Reconnect attempts', s.reconnects],
    ['TURN calls', s.turn_calls], ['Avg duration', `${s.avg_duration_s}s`],
  ] as const;
  return (
    <div>
      <div className="admin-grid">
        {cards.map(([label, val]) => (
          <div key={label} className="admin-stat"><div className="admin-stat-num">{val}</div><div className="admin-stat-label">{label}</div></div>
        ))}
      </div>
      <h4 className="admin-subhead">Recent calls</h4>
      <div className="admin-list">
        {s.recent.length === 0 && <div className="admin-empty">No calls recorded.</div>}
        {s.recent.map((c) => (
          <div key={c.id} className="admin-row compact">
            <span className="admin-tag">{c.type}</span>
            <span className={`admin-status ${c.status}`}>{c.status}</span>
            <span>conn: {c.connection_state || '—'}</span>
            <span>ICE✗ {c.ice_failures ?? 0}</span>
            <span>↻ {c.reconnects ?? 0}</span>
            <span>{c.turn_used ? 'TURN' : ''}</span>
            {c.failure_reason && <span className="admin-fail">{c.failure_reason}</span>}
            <span className="admin-row-meta">{new Date(c.started_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────
export function AdminMessages() {
  const [s, setS] = useState<AdminMessageStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [delId, setDelId] = useState('');
  useEffect(() => { adminMessageStats(supabase).then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="admin-warn">{err}</div>;
  if (!s) return <div className="admin-empty">Loading message metrics…</div>;
  const cards = [
    ['Total', s.total], ['Deleted', s.deleted], ['Delivered', s.delivered], ['Read', s.read],
    ['Undelivered', s.undelivered], ['Scheduled pending', s.scheduled_pending],
  ] as const;
  return (
    <div>
      <div className="admin-grid">
        {cards.map(([l, v]) => <div key={l} className="admin-stat"><div className="admin-stat-num">{v}</div><div className="admin-stat-label">{l}</div></div>)}
      </div>
      <h4 className="admin-subhead">Delete a message by ID</h4>
      <div className="admin-inline-form">
        <input placeholder="message UUID" value={delId} onChange={(e) => setDelId(e.target.value)} />
        <button className="danger" disabled={!delId} onClick={async () => {
          try { await adminDeleteMessage(supabase, delId.trim()); setDelId(''); alert('Message deleted.'); }
          catch (e: any) { alert(e.message); }
        }}>Delete message</button>
      </div>
      <p className="admin-hint">Offline queue / retry state lives on each device (local outbox) and isn’t visible server-side; these are the server-authoritative delivery counts.</p>
    </div>
  );
}

// ── Feature flags (owner) ─────────────────────────────────────────────────────
export function AdminFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => getFeatureFlags(supabase).then(setFlags);
  useEffect(() => { load(); }, []);
  async function toggle(f: FeatureFlag) {
    setBusy(f.key);
    try { await adminSetFeatureFlag(supabase, f.key, !f.enabled); await load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(null); }
  }
  return (
    <div className="admin-flags">
      <p className="admin-hint">Toggle features live for all clients — no app release required.</p>
      {flags.map((f) => (
        <label key={f.key} className="admin-flag">
          <span>{f.label || f.key}</span>
          <button className={`toggle ${f.enabled ? 'on' : 'off'}`} disabled={busy === f.key} onClick={() => toggle(f)}>
            {f.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </label>
      ))}
    </div>
  );
}

// ── App management (owner): announcements + kill switch ───────────────────────
export function AdminAppMgmt() {
  const [kind, setKind] = useState<AnnouncementKind>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [list, setList] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => getActiveAnnouncements(supabase).then(setList);
  useEffect(() => { load(); }, []);
  async function send() {
    if (!title.trim()) return;
    setBusy(true);
    try { await adminSendAnnouncement(supabase, kind, title.trim(), body.trim() || undefined); setTitle(''); setBody(''); await load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="admin-app-mgmt">
      <fieldset className="admin-action-group column" disabled={busy}>
        <legend>Broadcast to all users</legend>
        <select value={kind} onChange={(e) => setKind(e.target.value as AnnouncementKind)}>
          <option value="announcement">Announcement</option>
          <option value="maintenance">Maintenance notice</option>
          <option value="update">Update notification</option>
          <option value="force_update">Force app update</option>
        </select>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="Message (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        <button onClick={send} disabled={!title.trim()}>Send</button>
      </fieldset>

      <fieldset className="admin-action-group">
        <legend>App availability</legend>
        <button className="danger" onClick={async () => { if (confirm('Disable the app for ALL users?')) { try { await adminSetAppEnabled(supabase, false); alert('App disabled.'); } catch (e: any) { alert(e.message); } } }}>Disable app</button>
        <button onClick={async () => { try { await adminSetAppEnabled(supabase, true); alert('App enabled.'); } catch (e: any) { alert(e.message); } }}>Enable app</button>
      </fieldset>

      <h4 className="admin-subhead">Active announcements</h4>
      <div className="admin-list">
        {list.length === 0 && <div className="admin-empty">None active.</div>}
        {list.map((a) => (
          <div key={a.id} className="admin-row compact">
            <span className="admin-tag">{a.kind}</span>
            <span className="admin-row-title">{a.title}</span>
            <span className="admin-row-meta">{new Date(a.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Database health ───────────────────────────────────────────────────────────
export function AdminHealth() {
  const [h, setH] = useState<AdminDbHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, string>>({});
  useEffect(() => {
    adminDbHealth(supabase).then(setH).catch((e) => setErr(e.message));
    // Client-side probes for the services SQL can't see.
    (async () => {
      const p: Record<string, string> = {};
      try { const { error } = await supabase.auth.getSession(); p.auth = error ? 'error' : 'ok'; } catch { p.auth = 'error'; }
      try { const { error } = await supabase.storage.listBuckets(); p.storage = error ? 'error' : 'ok'; } catch { p.storage = 'error'; }
      try {
        const ch = supabase.channel('health-probe-' + Math.random().toString(36).slice(2));
        await new Promise<void>((res) => { ch.subscribe((s) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { p.realtime = s === 'SUBSCRIBED' ? 'ok' : 'error'; res(); } }); setTimeout(res, 4000); });
        supabase.removeChannel(ch);
      } catch { p.realtime = 'error'; }
      setProbes(p);
    })();
  }, []);
  if (err) return <div className="admin-warn">{err}</div>;
  const rows: [string, string][] = [
    ['Database', h ? h.database : '…'],
    ['DB latency', h ? `${h.latency_ms} ms` : '…'],
    ['Authentication', probes.auth || '…'],
    ['Storage', probes.storage || '…'],
    ['Realtime', probes.realtime || '…'],
    ['Pending deletions', h ? String(h.pending_deletions) : '…'],
    ['Oldest queued scheduled msg', h?.oldest_pending_scheduled ? new Date(h.oldest_pending_scheduled).toLocaleString() : 'none'],
  ];
  return (
    <div className="admin-health">
      {rows.map(([k, v]) => (
        <div key={k} className={`admin-health-row ${v === 'ok' ? 'ok' : v === 'error' ? 'bad' : ''}`}>
          <span>{k}</span><b>{v}</b>
        </div>
      ))}
      <p className="admin-hint">Edge Function status is verified via the AI feature calls; realtime/storage/auth are probed live from this browser.</p>
    </div>
  );
}

// ── Audit log (owner) ─────────────────────────────────────────────────────────
export function AdminAudit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminAuditLog(supabase, 300).then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="admin-warn">{err}</div>;
  return (
    <div className="admin-audit">
      {rows.length === 0 && <div className="admin-empty">No audit entries yet.</div>}
      <table className="admin-table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.actor_email || (r.actor_id ? r.actor_id.slice(0, 8) : '—')}</td>
              <td><span className="admin-tag">{r.action}</span></td>
              <td><code>{r.target ? String(r.target).slice(0, 12) : '—'}</code></td>
              <td className="admin-meta-cell">{r.meta ? JSON.stringify(r.meta) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Global search ─────────────────────────────────────────────────────────────
export function AdminSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<AdminGlobalSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr(null);
    try { setRes(await adminGlobalSearch(supabase, q.trim())); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="admin-gsearch">
      <form className="admin-search-bar" onSubmit={run}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users, communities, channels, messages, reports…" />
        <button disabled={busy}>{busy ? '…' : 'Search'}</button>
      </form>
      {err && <div className="admin-warn">{err}</div>}
      {res && (
        <div className="admin-gsearch-results">
          <Section title={`Users (${res.users.length})`}>{res.users.map((u) => <div key={u.id} className="admin-row compact"><b>{u.display_name || u.username}</b><span>{u.email}</span><span className={`admin-status ${u.account_status}`}>{u.account_status}</span></div>)}</Section>
          <Section title={`Communities (${res.communities.length})`}>{res.communities.map((c) => <div key={c.id} className="admin-row compact"><b>{c.name}</b><button className="danger sm" onClick={async () => { if (confirm(`Delete community "${c.name}"?`)) { try { await adminDeleteCommunity(supabase, c.id); alert('Deleted'); } catch (e: any) { alert(e.message); } } }}>Delete</button></div>)}</Section>
          <Section title={`Channels (${res.channels.length})`}>{res.channels.map((c) => <div key={c.id} className="admin-row compact"><b>{c.name}</b><span className="admin-tag">{c.kind}</span></div>)}</Section>
          <Section title={`Messages (${res.messages.length})`}>{res.messages.map((m) => <div key={m.id} className="admin-row compact"><span className="admin-tag">{m.type}</span><span>{m.content?.slice(0, 60)}</span><button className="danger sm" onClick={async () => { try { await adminDeleteMessage(supabase, m.id); alert('Deleted'); } catch (e: any) { alert(e.message); } }}>Delete</button></div>)}</Section>
          <Section title={`Reports (${res.reports.length})`}>{res.reports.map((r) => <div key={r.id} className="admin-row compact"><span className="admin-tag">{r.target_type}</span><span>{r.reason}</span><span className={`admin-status ${r.status}`}>{r.status}</span></div>)}</Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="admin-gsection">
      <h4 className="admin-subhead">{title}</h4>
      <div className="admin-list">{children}</div>
    </div>
  );
}
