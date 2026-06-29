// FUTUREHAT — inline poll card: question, options with live tallies + bars, and
// tap-to-vote (single or multiple choice). Self-contained: fetches its own votes
// and refetches after voting. Used inside ChatView's poll panel.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { getPollVotes, votePoll } from '@shared/communitiesApi';
import type { Poll, PollVote } from '@shared/communitiesApi';
import './PollCard.css';

export function PollCard({ poll, myId }: { poll: Poll; myId?: string }) {
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(() => {
    getPollVotes(supabase, poll.id).then(setVotes).catch(() => {});
  }, [poll.id]);

  useEffect(() => { refetch(); }, [refetch]);

  const total = votes.length;
  const myVotes = new Set(votes.filter((v) => v.user_id === myId).map((v) => v.option_index));
  const closed = poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false;

  async function cast(optionIndex: number) {
    if (busy || closed) return;
    // toggle off if single-choice re-tap on the same option is not supported by API;
    // for multiple, allow toggling our own vote off by deleting it.
    if (poll.multiple && myVotes.has(optionIndex)) {
      setBusy(true);
      await supabase.from('poll_votes').delete()
        .eq('poll_id', poll.id).eq('user_id', myId).eq('option_index', optionIndex);
      setBusy(false);
      refetch();
      return;
    }
    setBusy(true);
    await votePoll(supabase, poll.id, optionIndex, poll.multiple);
    setBusy(false);
    refetch();
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
            <button key={i} className={`poll-option ${mine ? 'mine' : ''}`} onClick={() => cast(i)} disabled={busy || closed}>
              <span className="poll-bar" style={{ width: `${pct}%` }} />
              <span className="poll-opt-label">{mine ? '✓ ' : ''}{opt}</span>
              <span className="poll-opt-count">{pct}% · {count}</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        {total} vote{total === 1 ? '' : 's'} · {poll.multiple ? 'multiple choice' : 'single choice'}
        {closed && ' · closed'}
      </div>
    </div>
  );
}
