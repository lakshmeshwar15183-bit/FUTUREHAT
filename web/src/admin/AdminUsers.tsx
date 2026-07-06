// FUTUREHAT — Admin ▸ User Management. Search any user (id/username/email/phone),
// view the full profile, and run every owner/admin action. Every action calls a
// server RPC that re-checks privilege and writes an audit_log row (0013); the
// buttons here only decide what to *offer*.

import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import {
  adminSearchUsers, adminGetUser,
  adminBanUser, adminSuspendUser, adminRestoreUser, adminDisableUser, adminLockUser,
  adminVerifyUser, adminForceLogout, adminDeleteAccount, adminSetRole,
  adminGrantPremium, adminRevokePremium, adminRemoveDevice,
  assignModerator, removeModerator,
} from '@shared/adminApi';
import type { AdminUserSummary, AdminUserDetail, PremiumDuration } from '@shared/types';

const DURATIONS: { id: PremiumDuration; label: string }[] = [
  { id: '1m', label: '1 Month' }, { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' }, { id: '1y', label: '1 Year' },
  { id: 'lifetime', label: 'Lifetime' }, { id: 'custom', label: 'Custom…' },
];

export function AdminUsers({ isOwner }: { isOwner: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dur, setDur] = useState<PremiumDuration>('1m');
  const [customEnd, setCustomEnd] = useState('');

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true); setMsg(null);
    try { setResults(await adminSearchUsers(supabase, q.trim())); }
    catch (err: any) { setMsg(err.message ?? 'Search failed'); }
    finally { setSearching(false); }
  }

  async function open(id: string) {
    setMsg(null);
    try { setDetail(await adminGetUser(supabase, id)); }
    catch (err: any) { setMsg(err.message ?? 'Could not load user'); }
  }

  // Run an action, then refresh the open detail so the UI reflects the new state.
  async function act(fn: () => Promise<void>, label: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true); setMsg(null);
    try {
      await fn();
      if (detail) setDetail(await adminGetUser(supabase, detail.id));
      setMsg(`✓ ${label}`);
    } catch (err: any) { setMsg(`✗ ${label}: ${err.message ?? 'failed'}`); }
    finally { setBusy(false); }
  }

  const u = detail;
  // The permanent OWNER account is absolutely protected: no one (not even the
  // Owner) may ban/suspend/disable/lock/force-logout/delete/demote/un-verify/manage
  // it. When the target is an owner we replace all management controls with a clean
  // read-only "Owner account — protected" state. The server (0013 _guard_owner_target
  // + 0026 _guard_protect_owner) enforces the same rule regardless of the request.
  const protectedOwner = !!u?.owner;

  return (
    <div className="admin-users">
      <form className="admin-search-bar" onSubmit={runSearch}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by user ID, username, email or phone…"
          aria-label="Search users"
        />
        <button type="submit" disabled={searching}>{searching ? '…' : 'Search'}</button>
      </form>

      {msg && <div className="admin-warn">{msg}</div>}

      <div className="admin-users-split">
        <div className="admin-users-list">
          {results.length === 0 && <div className="admin-empty">No results yet — search above.</div>}
          {results.map((r) => (
            <button key={r.id} className={`admin-user-row ${detail?.id === r.id ? 'active' : ''}`} onClick={() => open(r.id)}>
              <div className="admin-avatar">{r.avatar_url ? <img src={r.avatar_url} alt="" /> : (r.display_name || '?')[0]}</div>
              <div className="admin-user-row-main">
                <div className="admin-user-row-name">
                  {r.display_name || r.username || 'Unnamed'}
                  {r.verified && <span className="badge-verified" title="Verified">✓</span>}
                  {r.owner && <span className="badge-owner">OWNER</span>}
                  {r.role !== 'user' && !r.owner && <span className="badge-role">{r.role}</span>}
                </div>
                <div className="admin-user-row-sub">{r.email || r.phone || r.id.slice(0, 12)}</div>
              </div>
              <span className={`admin-status ${r.account_status}`}>{r.account_status}</span>
            </button>
          ))}
        </div>

        <div className="admin-user-detail">
          {!u ? (
            <div className="admin-empty">Select a user to manage.</div>
          ) : (
            <>
              <div className="admin-user-head">
                <div className="admin-avatar lg">{u.avatar_url ? <img src={u.avatar_url} alt="" /> : (u.display_name || '?')[0]}</div>
                <div>
                  <div className="admin-user-title">
                    {u.display_name || 'Unnamed'}
                    {u.verified && <span className="badge-verified">✓</span>}
                    {u.owner && <span className="badge-owner">OWNER</span>}
                    {u.premium && <span className="badge-premium">FUTUREHAT+</span>}
                  </div>
                  <div className="admin-user-sub">@{u.username || '—'} · {u.role}</div>
                </div>
                <span className={`admin-status ${u.account_status}`}>{u.account_status}</span>
              </div>

              <div className="admin-kv">
                <div><span>User ID</span><code>{u.id}</code></div>
                <div><span>Email</span><b>{u.email || '—'}</b></div>
                <div><span>Phone</span><b>{u.phone || '—'}</b></div>
                <div><span>Created</span><b>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</b></div>
                <div><span>Last online</span><b>{u.last_seen ? new Date(u.last_seen).toLocaleString() : '—'}</b></div>
                <div><span>Premium ends</span><b>{u.subscription?.current_period_end ? new Date(u.subscription.current_period_end).toLocaleDateString() : '—'}</b></div>
                {u.status_reason && <div><span>Status reason</span><b>{u.status_reason}</b></div>}
                {u.suspended_until && <div><span>Suspended until</span><b>{new Date(u.suspended_until).toLocaleString()}</b></div>}
              </div>

              {protectedOwner && (
                <div className="admin-owner-protected">
                  <span className="admin-owner-protected-icon">🛡️</span>
                  <div>
                    <div className="admin-owner-protected-title">Owner account — protected</div>
                    <div className="admin-owner-protected-body">
                      This is the permanent FUTUREHAT Owner. It cannot be banned, suspended, disabled,
                      locked, logged out, deleted, demoted, un-verified, or otherwise modified.
                    </div>
                  </div>
                </div>
              )}

              {/* Management controls — hidden entirely for the protected Owner account. */}
              {!protectedOwner && (<>
              <fieldset className="admin-action-group" disabled={busy || protectedOwner}>
                <legend>Account</legend>
                <button className="danger" onClick={() => act(() => adminBanUser(supabase, u.id, prompt('Ban reason?') || undefined), 'Banned', 'Permanently ban this account?')}>Ban</button>
                <button onClick={() => { const d = prompt('Suspend for how many days?', '7'); if (d) act(() => adminSuspendUser(supabase, u.id, new Date(Date.now() + Number(d) * 864e5).toISOString(), 'temporary suspension'), `Suspended ${d}d`); }}>Suspend</button>
                <button onClick={() => act(() => adminRestoreUser(supabase, u.id), 'Restored')}>Restore / Unban</button>
                <button onClick={() => act(() => adminDisableUser(supabase, u.id), 'Disabled')}>Disable</button>
                <button onClick={() => act(() => adminLockUser(supabase, u.id, 'suspicious activity'), 'Locked')}>Lock</button>
                <button onClick={() => act(() => adminForceLogout(supabase, u.id), 'Forced logout')}>Force logout</button>
                <button className="danger" onClick={() => act(() => adminDeleteAccount(supabase, u.id, prompt('Delete reason?') || undefined), 'Deleted', 'Delete this account? (soft-delete + deletion request)')}>Delete</button>
              </fieldset>

              <fieldset className="admin-action-group" disabled={busy || protectedOwner}>
                <legend>Verification</legend>
                <button onClick={() => act(() => adminVerifyUser(supabase, u.id, true), 'Verified')}>Verify</button>
                <button onClick={() => act(() => adminVerifyUser(supabase, u.id, false), 'Verification removed')}>Remove verification</button>
              </fieldset>

              <fieldset className="admin-action-group" disabled={busy || protectedOwner}>
                <legend>Premium</legend>
                <select value={dur} onChange={(e) => setDur(e.target.value as PremiumDuration)}>
                  {DURATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                {dur === 'custom' && <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />}
                <button onClick={() => act(() => adminGrantPremium(supabase, u.id, dur, dur === 'custom' ? new Date(customEnd).toISOString() : undefined), `Premium: ${dur}`)}>
                  Grant / Gift
                </button>
                <button onClick={() => act(() => adminRevokePremium(supabase, u.id), 'Premium removed')}>Remove premium</button>
                {dur === 'lifetime' && !isOwner && <span className="admin-hint">Lifetime is owner-only.</span>}
              </fieldset>

              <fieldset className="admin-action-group" disabled={busy || protectedOwner}>
                <legend>Role</legend>
                <button onClick={() => act(() => adminSetRole(supabase, u.id, 'user'), 'Set: User')}>Demote to User</button>
                {u.role === 'moderator' ? (
                  <button className="danger" onClick={() => act(
                    () => removeModerator(supabase, u.id),
                    'Moderator removed',
                    `Remove ${u.display_name || 'this user'} as a FUTUREHAT Moderator? They will be notified and lose the Moderator Dashboard.`,
                  )}>Remove Moderator</button>
                ) : (
                  <button onClick={() => act(
                    () => assignModerator(supabase, u.id),
                    'Moderator assigned',
                    `Appoint ${u.display_name || 'this user'} as an official FUTUREHAT Moderator? They will be notified and gain the Moderator Dashboard.`,
                  )}>Assign Moderator</button>
                )}
                {/* Admin is permanent (single hardcoded owner/admin) — never assignable via the app. */}
              </fieldset>
              </>)}

              <fieldset className="admin-action-group column" disabled={busy}>
                <legend>Devices ({u.devices.length})</legend>
                {u.devices.length === 0 && <div className="admin-empty sm">No registered devices.</div>}
                {u.devices.map((d) => (
                  <div key={d.id} className="admin-device">
                    <span>📱 {d.name || d.device_id} · {d.platform || '?'} · {new Date(d.last_seen).toLocaleDateString()}</span>
                    <button onClick={() => act(() => adminRemoveDevice(supabase, d.id), 'Device removed')} disabled={protectedOwner}>Remove</button>
                  </div>
                ))}
              </fieldset>

              {u.recent_security.length > 0 && (
                <fieldset className="admin-action-group column">
                  <legend>Recent security events</legend>
                  {u.recent_security.slice(0, 8).map((e, i) => (
                    <div key={i} className="admin-sec-row">
                      <b>{e.kind}</b> · {e.ip || '—'} · {new Date(e.created_at).toLocaleString()}
                    </div>
                  ))}
                </fieldset>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
