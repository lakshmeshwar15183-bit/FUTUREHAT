// Lumixo — inline poll card: tallies, single/multi, close, view voters, anonymous.
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import {
  getPollVotes,
  votePoll,
  closePoll,
  getPollVoters,
  unvotePoll,
} from '@shared/communitiesApi';
import type { Poll, PollVote } from '@shared/communitiesApi';
import './PollCard.css';

export function PollCard({
  poll,
  myId,
  onClosed,
}: {
  poll: Poll;
  myId?: string;
  onClosed?: (poll: Poll) => void;
}) {
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [busy, setBusy] = useState(false);
  const [votersFor, setVotersFor] = useState<number | null>(null);
  const [voters, setVoters] = useState<{ userId: string; displayName: string | null }[]>([]);

  const refetch = useCallback(() => {
    getPollVotes(supabase, poll.id).then(setVotes).catch(() => {});
  }, [poll.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const total = votes.length;
  const myVotes = new Set(votes.filter((v) => v.user_id === myId).map((v) => v.option_index));
  const closed = poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false;
  const isCreator = !!myId && poll.created_by === myId;
  const anonymous = !!poll.anonymous;

  async function cast(optionIndex: number) {
    if (busy || closed) return;
    if (poll.multiple && myVotes.has(optionIndex)) {
      setBusy(true);
      await unvotePoll(supabase, poll.id, optionIndex);
      setBusy(false);
      refetch();
      return;
    }
    setBusy(true);
    await votePoll(supabase, poll.id, optionIndex, poll.multiple);
    setBusy(false);
    refetch();
  }

  async function doClose() {
    if (!isCreator || closed || busy) return;
    if (!confirm('Close this poll? No more votes will be accepted.')) return;
    setBusy(true);
    const { error } = await closePoll(supabase, poll.id);
    setBusy(false);
    if (!error) {
      const next = { ...poll, closes_at: new Date().toISOString() };
      onClosed?.(next);
    }
  }

  async function showVoters(optionIndex: number) {
    if (anonymous) return;
    if (votersFor === optionIndex) {
      setVotersFor(null);
      return;
    }
    setVotersFor(optionIndex);
    const list = await getPollVoters(supabase, poll.id, optionIndex);
    setVoters(list);
  }

  return (
    <div className="poll-card">
      <div className="poll-q">📊 {poll.question}</div>
      <div className="poll-options">
        {poll.options.map((opt, i) => {
          const count = votes.filter((v) => v.option_index === i).length;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const mine = myVotes.has(i);
          return (
            <div key={i} className="poll-option-wrap">
              <button
                type="button"
                className={`poll-option ${mine ? 'mine' : ''}`}
                onClick={() => cast(i)}
                disabled={busy || closed}
              >
                <span className="poll-bar" style={{ width: `${pct}%` }} />
                <span className="poll-opt-label">
                  {mine ? '✓ ' : ''}
                  {opt}
                </span>
                <span className="poll-opt-count">
                  {pct}% · {count}
                </span>
              </button>
              {!anonymous && count > 0 && (
                <button
                  type="button"
                  className="poll-voters-toggle"
                  onClick={() => showVoters(i)}
                >
                  {votersFor === i ? 'Hide voters' : 'View voters'}
                </button>
              )}
              {votersFor === i && !anonymous && (
                <ul className="poll-voters">
                  {voters.map((v) => (
                    <li key={v.userId}>{v.displayName || 'Member'}</li>
                  ))}
                  {voters.length === 0 && <li>No voters</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="poll-foot">
        {total} vote{total === 1 ? '' : 's'} ·{' '}
        {poll.multiple ? 'multiple choice' : 'single choice'}
        {anonymous ? ' · anonymous' : ''}
        {closed && ' · closed'}
        {isCreator && !closed && (
          <>
            {' · '}
            <button type="button" className="poll-close-btn" onClick={doClose} disabled={busy}>
              Close poll
            </button>
          </>
        )}
      </div>
    </div>
  );
}
