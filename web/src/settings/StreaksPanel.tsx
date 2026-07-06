// FUTUREHAT web — Settings › Streaks panel. Mirrors the mobile Streaks section:
// a hub with the user's active streaks, the info pages (How it works, Qualifying
// activities, Levels, Rewards, Penalties, Restrictions, Moderator selection) and
// the Hall of Legends. Server-authoritative reads via shared/streakApi; the emoji
// is derived from the authoritative score. Loading / empty / error states included.

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../supabase';
import {
  getMyStreaks, getStreak, getHallOfLegends, processMyStreaks,
  STREAK_TIERS, tierForScore, nextTier,
} from '@shared/streakApi';
import type { StreakSummary, StreakDetail, HallOfLegendsEntry } from '@shared/types';
import { modalBackdrop, modalPanel } from '../motion';
import './settings-panels.css';

type View =
  | { name: 'hub' }
  | { name: 'detail'; conversationId: string; title: string }
  | { name: 'legends' }
  | { name: 'info'; page: InfoPage };

type InfoPage = 'how' | 'qualifying' | 'levels' | 'rewards' | 'penalties' | 'restrictions' | 'moderator';

const INFO_TITLES: Record<InfoPage, string> = {
  how: 'How streaks work',
  qualifying: 'Qualifying activities',
  levels: 'Streak levels',
  rewards: 'Rewards',
  penalties: 'Penalties & demotions',
  restrictions: 'Restrictions & anti-abuse',
  moderator: 'Moderator selection',
};

export function StreaksPanel({ onClose, onOpenChat }: { onClose: () => void; onOpenChat?: (conversationId: string) => void }) {
  const [view, setView] = useState<View>({ name: 'hub' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (view.name !== 'hub') setView({ name: 'hub' }); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, view.name]);

  const back = () => setView({ name: 'hub' });

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="sp-modal" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        {view.name === 'hub' && <Hub setView={setView} onOpenChat={onOpenChat} onClose={onClose} />}
        {view.name === 'detail' && <Detail conversationId={view.conversationId} title={view.title} onBack={back} />}
        {view.name === 'legends' && <Legends onBack={back} />}
        {view.name === 'info' && <Info page={view.page} onBack={back} />}
      </motion.div>
    </motion.div>
  );
}

function Hub({ setView, onOpenChat, onClose }: {
  setView: (v: View) => void; onOpenChat?: (id: string) => void; onClose: () => void;
}) {
  const [items, setItems] = useState<StreakSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      await processMyStreaks(supabase).catch(() => 0);
      setItems(await getMyStreaks(supabase));
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const infoPages: InfoPage[] = ['how', 'qualifying', 'levels', 'rewards', 'penalties', 'restrictions', 'moderator'];

  return (
    <>
      <h2 className="sp-title">🎏 Streaks</h2>
      <p className="sp-sub">Keep a daily streak going with a friend. Both of you must show up each day.</p>

      <section className="sp-section">
        {infoPages.map((p) => (
          <button key={p} className="settings-link" onClick={() => setView({ name: 'info', page: p })}>{INFO_TITLES[p]} →</button>
        ))}
        <button className="settings-link" onClick={() => setView({ name: 'legends' })}>🏆 Hall of Legends →</button>
      </section>

      <h3 className="sp-h3">Your streaks</h3>
      {loading && items.length === 0 ? (
        <div className="sp-note">Loading…</div>
      ) : error && items.length === 0 ? (
        <div className="sp-note">Couldn’t load streaks. <button className="sp-linkbtn" onClick={load}>Retry</button></div>
      ) : items.length === 0 ? (
        <div className="sp-note">No streaks yet. Message a friend every day — when you both qualify, your streak begins. 🎏</div>
      ) : (
        <section className="sp-section">
          {[...items].sort((a, b) => b.score - a.score).map((s) => (
            <div className="sp-row" key={s.streak_id}>
              <div
                className="sp-row-main"
                style={{ cursor: 'pointer' }}
                onClick={() => setView({ name: 'detail', conversationId: s.conversation_id, title: s.peer_name ?? (s.peer_username ? `@${s.peer_username}` : 'Streak') })}
              >
                <div className="sp-row-name">
                  <span className="streak-emoji" aria-hidden>{s.tier}</span>{' '}
                  {s.peer_name ?? (s.peer_username ? `@${s.peer_username}` : 'FUTUREHAT user')}
                  <span className="streak-score"> · {s.score}</span>
                </div>
                <div className="sp-row-desc">
                  {s.completed_today ? 'Completed today ✓'
                    : s.i_qualified_today ? 'Waiting on them today…'
                    : s.peer_qualified_today ? 'They’re waiting on you today'
                    : `${s.successful_days} successful day${s.successful_days === 1 ? '' : 's'}`}
                </div>
              </div>
              {onOpenChat && (
                <button className="sp-btn" onClick={() => { onClose(); onOpenChat(s.conversation_id); }}>Open chat</button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Detail({ conversationId, title, onBack }: { conversationId: string; title: string; onBack: () => void }) {
  const [data, setData] = useState<StreakDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try { setData(await getStreak(supabase, conversationId)); }
      catch { setError(true); } finally { setLoading(false); }
    })();
  }, [conversationId]);

  const score = data?.streak?.score ?? 0;
  const tier = tierForScore(score);
  const next = nextTier(score);
  const pct = next && next.max !== Infinity
    ? Math.min(1, Math.max(0, (score - (tier?.min ?? 0)) / (next.min - (tier?.min ?? 0)))) : 1;

  const reasonLabel = (r: string) => r === 'daily_award' ? 'Daily streak completed' : r === 'missed_penalty' ? 'Missed day penalty' : r === 'milestone' ? 'Milestone' : r;

  return (
    <>
      <button className="sp-back" onClick={onBack}>← Streaks</button>
      <h2 className="sp-title">{title}</h2>
      {loading && !data ? <div className="sp-note">Loading…</div>
        : error && !data ? <div className="sp-note">Couldn’t load this streak.</div>
        : (
          <>
            <div className="streak-hero">
              <div className="streak-hero-emoji" aria-hidden>{tier?.emoji ?? '🎏'}</div>
              <div className="streak-hero-score">{score}</div>
              <div className="streak-hero-tier">{tier?.label ?? 'No streak yet'}</div>
              <div className="streak-hero-days">{data?.streak?.successful_days ?? 0} successful days</div>
              {next && (
                <div className="streak-progress">
                  <div className="streak-progress-track"><div className="streak-progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                  <div className="streak-progress-label">
                    {next.max === Infinity ? 'Top tier reached 🏆' : `${next.min - score} to ${next.emoji} ${next.label}`}
                  </div>
                </div>
              )}
            </div>

            {(data?.milestones?.length ?? 0) > 0 && (
              <>
                <h3 className="sp-h3">Milestones</h3>
                <section className="sp-section">
                  {data!.milestones.map((m, i) => (
                    <div className="sp-row" key={i}>
                      <div className="sp-row-main">
                        <div className="sp-row-name">
                          {m.kind === 'diamond' ? '💎 Diamond — 1 month FUTUREHAT+' : m.kind === 'hall_of_legends' ? '🏆 Hall of Legends' : '🛡 Moderator milestone'}
                        </div>
                        <div className="sp-row-desc">
                          Reached at {m.achieved_score} · {new Date(m.achieved_at).toLocaleDateString()}{m.reward_granted ? ' · reward granted' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              </>
            )}

            <h3 className="sp-h3">Streak history</h3>
            {(data?.events?.length ?? 0) === 0 ? <div className="sp-note">No history yet.</div> : (
              <section className="sp-section">
                {data!.events.map((e, i) => (
                  <div className="sp-row" key={i}>
                    <div className="sp-row-main">
                      <div className="sp-row-name">
                        <span className={e.delta >= 0 ? 'streak-delta-pos' : 'streak-delta-neg'}>{e.delta >= 0 ? `+${e.delta}` : e.delta}</span>{' '}
                        {reasonLabel(e.reason)}
                      </div>
                      <div className="sp-row-desc">{e.day ?? new Date(e.created_at).toLocaleDateString()} · {e.old_score} → {e.new_score}</div>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
    </>
  );
}

function Legends({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<HallOfLegendsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [more, setMore] = useState(false);

  const loadFirst = useCallback(async () => {
    try { setError(false); const rows = await getHallOfLegends(supabase, { limit: 50 }); setItems(rows); setDone(rows.length < 50); }
    catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  async function loadMore() {
    if (more || done || items.length === 0) return;
    setMore(true);
    try {
      const before = items[items.length - 1]?.achieved_at;
      const rows = await getHallOfLegends(supabase, { limit: 50, before });
      setItems((p) => [...p, ...rows]);
      if (rows.length < 50) setDone(true);
    } catch { /* keep */ } finally { setMore(false); }
  }

  return (
    <>
      <button className="sp-back" onClick={onBack}>← Streaks</button>
      <h2 className="sp-title">🏆 Hall of Legends</h2>
      <p className="sp-sub">Pairs who reached 730 — about two years of streak.</p>
      {loading && items.length === 0 ? <div className="sp-note">Loading…</div>
        : error && items.length === 0 ? <div className="sp-note">Couldn’t load the Hall of Legends. <button className="sp-linkbtn" onClick={loadFirst}>Retry</button></div>
        : items.length === 0 ? <div className="sp-note">No legends yet. Be the first pair to reach 730. 🏆</div>
        : (
          <section className="sp-section">
            {items.map((h) => (
              <div className="sp-row" key={h.streak_id}>
                <div className="sp-row-main">
                  <div className="sp-row-name">
                    🏆 {(h.user_a_name ?? h.user_a_username ?? 'FUTUREHAT user')} &amp; {(h.user_b_name ?? h.user_b_username ?? 'FUTUREHAT user')}
                  </div>
                  <div className="sp-row-desc">Legends since {new Date(h.achieved_at).toLocaleDateString()} · now {h.current_score} {h.current_tier}</div>
                </div>
              </div>
            ))}
            {!done && <button className="sp-btn sp-more" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Load more'}</button>}
          </section>
        )}
    </>
  );
}

interface Block { h?: string; p?: string; bullets?: string[]; }
const PAGES: Record<Exclude<InfoPage, 'levels'>, Block[]> = {
  how: [
    { p: 'A streak is a bond between two people — you and one friend. It lives with the pair, not a device or a chat in your list.' },
    { h: 'Both must show up', p: 'Each day, both of you must independently do at least one qualifying activity. If only one participates, the day does not count — no matter how much that one person sends.' },
    { h: 'One point a day, max', p: 'A completed day adds exactly +1. Doing five things in a day still adds only +1.' },
    { h: 'Miss a day, lose points', p: 'A missed day costs the pair 3 points. Your score can never go below 0.' },
    { h: 'Your tier follows your score', p: 'The emoji is decided by your current score. Lose enough points and you can be demoted.' },
    { h: 'Locking & archiving are safe', p: 'Locking, archiving, hiding or removing a chat never pauses, resets, duplicates or deletes your streak. Activity in a locked or archived chat still counts.' },
    { h: 'The server decides', p: 'Days are measured on one consistent daily window (UTC) on our servers. Changing your device clock or timezone does nothing.' },
  ],
  qualifying: [
    { p: 'During each daily window, you must independently complete at least one of these:' },
    { bullets: ['One text message with at least 5 real words', 'One photo you successfully send', 'One video you successfully send', 'One connected voice call lasting more than 15 seconds', 'One connected video call lasting more than 15 seconds'] },
    { h: 'And so must they', p: 'Your partner must independently qualify too. Only when both of you qualify does the day complete for +1.' },
    { h: 'What does NOT count', bullets: ['Five separate one-word messages (a single message must itself have 5+ words)', 'Failed, unsent or draft messages', 'Missed, rejected, unanswered or cancelled calls', 'Ringing time — only connected time counts, and it must exceed 15 seconds'] },
  ],
  rewards: [
    { h: '💎 Diamond — 365 points', p: 'The first time your pair reaches 365, you both receive one month of FUTUREHAT+ Premium, free. If you already have Premium, the month is added on top — it never shortens what you already have.' },
    { h: 'Once per pair, ever', p: 'Each milestone reward is granted a single time for the lifetime of the pair. You cannot lose points and re-earn the same reward.' },
    { h: '🛡 Moderator milestone — 367 points', p: 'Just past Diamond, the pair becomes eligible for the Moderator reward. See “Moderator selection”.' },
    { h: '🏆 Hall of Legends — 730 points', p: 'Around two years of streak earns your pair a permanent place in the Hall of Legends.' },
  ],
  penalties: [
    { h: 'Scoring', bullets: ['A completed mutual day: +1', 'A missed day: −3', 'Minimum score: 0 (never negative)'] },
    { h: 'Demotion is immediate', p: 'Because your tier is based on your current score, losing points can drop you to a lower tier right away.' },
    { h: 'Example', p: 'You are at 100 💜 (Purple Heart). You miss a day: −3 → 97. You immediately move back to ❤️ (Red Heart).' },
  ],
  restrictions: [
    { p: 'Streaks are enforced entirely on the server. The app can only show your streak — it can never set your score, claim a reward, or grant a role.' },
    { h: 'We protect against', bullets: ['Forged or client-supplied scores and milestone claims', 'Fake or replayed activity and duplicate events', 'Fake call durations (only real connected time counts)', 'Repeated reward claims (each milestone pays out once, ever)', 'Two devices or races processing the same day twice', 'Device clock / timezone manipulation (one fixed server window)', 'Deleting a message after it qualified'] },
    { h: 'Accounts', p: 'Blocked, deleted, banned, suspended or disabled accounts are handled safely and do not receive rewards or roles they aren’t entitled to.' },
  ],
  moderator: [
    { p: 'After your pair passes the Diamond stage, you become eligible for the Moderator reward.' },
    { h: 'When', p: 'The pair becomes eligible when the streak reaches 367 points. The system processes this milestone automatically.' },
    { h: 'Who', p: 'Only one person from the pair is selected as Moderator — not both. Selection is decided and applied entirely on the server, recorded in an audit log, and can never be triggered from the app.' },
    { h: 'Safety', p: 'The reward can never demote an owner, corrupt admin privileges, or let anyone promote themselves. Moderators cannot change streak scores.' },
  ],
};

function Info({ page, onBack }: { page: InfoPage; onBack: () => void }) {
  return (
    <>
      <button className="sp-back" onClick={onBack}>← Streaks</button>
      <h2 className="sp-title">{INFO_TITLES[page]}</h2>
      {page === 'levels' ? (
        <>
          <p className="sp-sub">Your tier is decided by your current score:</p>
          <section className="sp-section">
            {STREAK_TIERS.map((t) => (
              <div className="sp-row streak-level-row" key={t.emoji + t.min}>
                <span className="streak-level-emoji" aria-hidden>{t.emoji}</span>
                <span className="streak-level-label">{t.label}</span>
                <span className="streak-level-range">{t.max === Infinity ? `${t.min}+` : t.min === t.max ? `${t.min}` : `${t.min}–${t.max}`}</span>
              </div>
            ))}
          </section>
          <p className="sp-note">💎 is the exact 365-point Diamond milestone. 🪙 continues from 366 to 729. 🏆 is Hall of Legends at 730+.</p>
        </>
      ) : (
        <div className="streak-info">
          {PAGES[page as Exclude<InfoPage, 'levels'>].map((b, i) => (
            <div key={i} className="streak-info-block">
              {b.h && <h3 className="sp-h3">{b.h}</h3>}
              {b.p && <p className="streak-info-p">{b.p}</p>}
              {b.bullets && <ul className="streak-info-ul">{b.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
